import { AppError } from '../errors'
import type {
  Binding,
  IntrospectedTable,
  ListSpec,
  SourceConfig,
  SourceDriver,
  SourceFilter,
  SourceRow,
} from './types'

// M3: the duckdb/MotherDuck driver — strictly read-only (the warehouse
// browser). The connection string comes from the env var named by url_env:
// either a MotherDuck URL (md:?motherduck_token=... — the recommended shape,
// with a read-scaling token) or a local .duckdb file path (used by tests).
// @duckdb/node-api is pinned to a DuckDB version MotherDuck supports; 1.5.5
// was rejected by the MotherDuck extension at the time of writing.
//
// external_schema holds the full catalog-qualified schema ("gold.main" on
// MotherDuck, "main" locally); identifiers are quoted part by part and every
// value is a bound parameter.

// Lazy import: the native module costs ~100MB on disk and a dlopen at load;
// servers that never touch a duckdb source shouldn't pay it at boot.
type DuckDBModule = typeof import('@duckdb/node-api')
let duckdbModule: Promise<DuckDBModule> | null = null
function loadDuckdb(): Promise<DuckDBModule> {
  duckdbModule ??= import('@duckdb/node-api')
  return duckdbModule
}

interface InstanceEntry {
  instance: import('@duckdb/node-api').DuckDBInstance
  url: string
}
const instances = new Map<string, Promise<InstanceEntry>>()

function requireUrl(cfg: SourceConfig): string {
  if (!cfg.url_env)
    throw new AppError('ValidationError', `Data source ${cfg.name} has no url_env configured`)
  const value = process.env[cfg.url_env]
  if (!value)
    throw new AppError(
      'ValidationError',
      `Environment variable ${cfg.url_env} is not set (required by data source ${cfg.name})`,
    )
  return value
}

async function instanceFor(cfg: SourceConfig): Promise<InstanceEntry> {
  const url = requireUrl(cfg)
  const cached = await instances.get(cfg.name)?.catch(() => null)
  if (cached && cached.url === url) return cached
  const entry = (async () => {
    const { DuckDBInstance } = await loadDuckdb()
    const instance = await DuckDBInstance.create(url)
    return { instance, url }
  })()
  instances.set(cfg.name, entry)
  return entry
}

function wrapError(cfg: SourceConfig, err: unknown): never {
  if (err instanceof AppError) throw err
  const message = err instanceof Error ? err.message : String(err)
  const secret = cfg.url_env ? process.env[cfg.url_env] : undefined
  throw new AppError(
    'DataSourceError',
    `Data source ${cfg.name} failed: ${secret ? message.split(secret).join(`$${cfg.url_env}`) : message}`,
  )
}

// JSON-safe rows: getRowObjectsJson() renders BIGINT/DECIMAL as strings and
// DATE/TIMESTAMP as ISO-ish strings — exactly what the read-only Desk needs.
async function run(cfg: SourceConfig, text: string, params: unknown[]): Promise<SourceRow[]> {
  try {
    const { instance } = await instanceFor(cfg)
    const conn = await instance.connect()
    try {
      const reader = await conn.runAndReadAll(text, params as never[])
      return reader.getRowObjectsJson() as SourceRow[]
    } finally {
      conn.closeSync()
    }
  } catch (err) {
    wrapError(cfg, err)
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

// "gold.main" → "gold"."main" — quoted part by part.
function quoteSchema(schema: string): string {
  return schema.split('.').map(quoteIdent).join('.')
}

function relation(bind: Binding): string {
  return `${quoteSchema(bind.schema)}.${quoteIdent(bind.table)}`
}

function buildWhere(filters: SourceFilter[]): { text: string; values: unknown[] } {
  const parts: string[] = []
  const values: unknown[] = []
  for (const f of filters) {
    const col = quoteIdent(f.column)
    switch (f.op) {
      case '=':
        parts.push(`${col} = ?`)
        values.push(f.value)
        break
      case '!=':
        parts.push(`${col} is distinct from ?`)
        values.push(f.value)
        break
      case '>':
      case '<':
      case '>=':
      case '<=':
        parts.push(`${col} ${f.op} ?`)
        values.push(f.value)
        break
      case 'like':
        parts.push(`${col}::varchar ilike ?`)
        values.push(f.value)
        break
      case 'not like':
        parts.push(`${col}::varchar not ilike ?`)
        values.push(f.value)
        break
      case 'in':
      case 'not in': {
        const list = Array.isArray(f.value) ? (f.value as unknown[]) : []
        if (!list.length) {
          parts.push(f.op === 'in' ? 'false' : 'true')
          break
        }
        parts.push(`${col} ${f.op === 'in' ? 'in' : 'not in'} (${list.map(() => '?').join(', ')})`)
        values.push(...list)
        break
      }
      case 'in_or_null': {
        // Data Scope narrowing (PERM-005): an UNSET reference passes.
        const list = Array.isArray(f.value) ? (f.value as unknown[]) : []
        if (!list.length) {
          parts.push(`${col} is null`)
          break
        }
        parts.push(`(${col} is null or ${col} in (${list.map(() => '?').join(', ')}))`)
        values.push(...list)
        break
      }
    }
  }
  return { text: parts.length ? parts.join(' and ') : 'true', values }
}

const READ_ONLY = () => {
  throw new AppError('PermissionError', 'DuckDB/MotherDuck sources are read-only')
}

export const duckdbDriver: SourceDriver = {
  engine: 'duckdb',
  writable: false,

  async test(cfg) {
    await run(cfg, 'select 1', [])
  },

  async introspect(cfg, schema?): Promise<IntrospectedTable[]> {
    // On MotherDuck every attached database is a catalog; the browsable
    // schema key is "<catalog>.<schema>". A filter of "gold" (no dot) means
    // every schema in the gold catalog; "gold.main" narrows to one.
    const filter = schema ?? cfg.default_schema ?? null
    const [catalog, schemaPart] = filter
      ? filter.includes('.')
        ? [filter.slice(0, filter.indexOf('.')), filter.slice(filter.indexOf('.') + 1)]
        : [filter, null]
      : [null, null]
    const rows = await run(
      cfg,
      `select table_catalog, table_schema, table_name, column_name, data_type,
              is_nullable, column_default, character_maximum_length, ordinal_position
       from information_schema.columns
       where table_schema not in ('information_schema', 'pg_catalog')
         and (?::varchar is null or table_catalog = ?)
         and (?::varchar is null or table_schema = ?)
       order by table_catalog, table_schema, table_name, ordinal_position`,
      [catalog, catalog, schemaPart, schemaPart],
    )
    const tables = new Map<string, IntrospectedTable>()
    for (const r of rows) {
      const schemaKey = `${r.table_catalog}.${r.table_schema}`
      const key = `${schemaKey}.${r.table_name}`
      let t = tables.get(key)
      if (!t) {
        // Warehouse tables have no declared primary key; every table is
        // browsable but none is row-addressable until a pk-like column is
        // chosen. The reflector falls back to rowid-free "first column" —
        // see reflect.ts.
        t = { schema: schemaKey, table: String(r.table_name), pk: null, columns: [] }
        tables.set(key, t)
      }
      t.columns.push({
        name: String(r.column_name),
        data_type: String(r.data_type),
        nullable: r.is_nullable !== 'NO',
        has_default: r.column_default != null,
        is_pk: false,
        max_length: r.character_maximum_length == null ? null : Number(r.character_maximum_length),
        column_type: mapDuckType(String(r.data_type)),
      })
    }
    return [...tables.values()]
  },

  async getList(bind, spec: ListSpec) {
    const cols = [...new Set([bind.pk, ...spec.columns])].map(quoteIdent).join(', ')
    const { text, values } = buildWhere(spec.filters)
    const order = `${quoteIdent(spec.order.column)} ${spec.order.dir === 'desc' ? 'desc' : 'asc'}`
    const rows = await run(
      bind.source,
      `select ${cols} from ${relation(bind)} where ${text}
       order by ${order} limit ${spec.limit} offset ${spec.offset}`,
      values,
    )
    const [{ count }] = await run(
      bind.source,
      `select count(*)::int as count from ${relation(bind)} where ${text}`,
      values,
    )
    return { rows, total: Number(count) }
  },

  async getDoc(bind, pk) {
    const rows = await run(
      bind.source,
      `select * from ${relation(bind)} where ${quoteIdent(bind.pk)}::varchar = ? limit 1`,
      [pk],
    )
    return rows[0] ?? null
  },

  async count(bind, filters) {
    const { text, values } = buildWhere(filters)
    const [{ count }] = await run(
      bind.source,
      `select count(*)::int as count from ${relation(bind)} where ${text}`,
      values,
    )
    return Number(count)
  },

  async groupCount(bind, column, filters) {
    const { text, values } = buildWhere(filters)
    const rows = await run(
      bind.source,
      `select ${quoteIdent(column)}::varchar as label, count(*)::int as value
       from ${relation(bind)} where ${text}
       group by ${quoteIdent(column)} order by value desc, label asc`,
      values,
    )
    return rows.map((r) => ({ label: String(r.label ?? ''), value: Number(r.value) }))
  },

  insert: READ_ONLY,
  update: READ_ONLY,
  remove: READ_ONLY,

  dispose(sourceName) {
    const entry = instances.get(sourceName)
    instances.delete(sourceName)
    void entry?.then((e) => e.instance.closeSync()).catch(() => {})
  },
}

function mapDuckType(dataType: string): string {
  const t = dataType.toUpperCase()
  if (t.startsWith('DECIMAL') || t === 'FLOAT' || t === 'DOUBLE' || t === 'REAL') return 'Float'
  if (
    t === 'TINYINT' || t === 'SMALLINT' || t === 'INTEGER' || t === 'BIGINT' ||
    t === 'HUGEINT' || t.startsWith('UINT') || t === 'UTINYINT' || t === 'USMALLINT' ||
    t === 'UINTEGER' || t === 'UBIGINT'
  )
    return 'Int'
  if (t === 'BOOLEAN') return 'Check'
  if (t === 'DATE') return 'Date'
  if (t.startsWith('TIMESTAMP')) return 'Datetime'
  if (t === 'JSON' || t.startsWith('STRUCT') || t.startsWith('LIST') || t.startsWith('MAP'))
    return 'JSON'
  if (t === 'VARCHAR' || t === 'UUID') return 'Data'
  return 'Text'
}
