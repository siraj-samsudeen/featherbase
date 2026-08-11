import postgres from 'postgres'
import { AppError } from '../errors'
import { fkKey, singleColumnFks } from './fk'
import type {
  Binding,
  IntrospectedTable,
  ListSpec,
  SourceConfig,
  SourceDriver,
  SourceFilter,
  SourceRow,
} from './types'

// EDS-5/6: the postgres driver. One bounded pool per source (EDS-1), every
// identifier quoted, every value a bound parameter (IV2/IV4). This pool is
// completely separate from db.ts — the control database's client (and its
// test-sandbox delegate) is never used for foreign rows.

const pools = new Map<string, ReturnType<typeof postgres>>()

function pool(cfg: SourceConfig): ReturnType<typeof postgres> {
  const cached = pools.get(cfg.name)
  if (cached) return cached
  const url = requireUrl(cfg)
  const client = postgres(url, {
    max: cfg.pool_max,
    connect_timeout: 10,
    idle_timeout: 60,
    prepare: false,
    connection: { statement_timeout: cfg.statement_timeout_ms },
  })
  pools.set(cfg.name, client)
  return client
}

function requireUrl(cfg: SourceConfig): string {
  // Local import to avoid a registry<->driver cycle at module load.
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

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function relation(bind: Binding): string {
  return `${quoteIdent(bind.schema)}.${quoteIdent(bind.table)}`
}

// WHERE builder: returns SQL text with $n placeholders plus the value list.
function buildWhere(filters: SourceFilter[], startAt = 1): { text: string; values: unknown[] } {
  const parts: string[] = []
  const values: unknown[] = []
  let n = startAt
  for (const f of filters) {
    const col = quoteIdent(f.column)
    switch (f.op) {
      case '=':
        parts.push(`${col} = $${n++}`)
        values.push(f.value)
        break
      case '!=':
        parts.push(`${col} is distinct from $${n++}`)
        values.push(f.value)
        break
      case '>':
      case '<':
      case '>=':
      case '<=':
        parts.push(`${col} ${f.op} $${n++}`)
        values.push(f.value)
        break
      case 'like':
        parts.push(`${col}::text ilike $${n++}`)
        values.push(f.value)
        break
      case 'not like':
        parts.push(`${col}::text not ilike $${n++}`)
        values.push(f.value)
        break
      case 'in':
      case 'not in': {
        const list = Array.isArray(f.value) ? (f.value as unknown[]) : []
        if (!list.length) {
          parts.push(f.op === 'in' ? 'false' : 'true')
          break
        }
        const ph = list.map(() => `$${n++}`)
        parts.push(`${col} ${f.op === 'in' ? 'in' : 'not in'} (${ph.join(', ')})`)
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
        const ph = list.map(() => `$${n++}`)
        parts.push(`(${col} is null or ${col} in (${ph.join(', ')}))`)
        values.push(...list)
        break
      }
    }
  }
  return { text: parts.length ? parts.join(' and ') : 'true', values }
}

// EDS-11: name the source in every failure instead of leaking driver noise,
// but keep constraint details (mapDbError in document.ts reads .code/.detail).
function wrapError(cfg: SourceConfig, err: unknown): never {
  const e = err as { code?: string; message?: string }
  if (e?.code && /^23|^22/.test(e.code)) throw err as Error
  if (err instanceof AppError) throw err
  throw new AppError(
    'DataSourceError',
    `Data source ${cfg.name} failed: ${e?.message ?? String(err)}`,
  )
}

async function run(cfg: SourceConfig, text: string, values: unknown[]): Promise<SourceRow[]> {
  try {
    return (await pool(cfg).unsafe(text, values as never[])) as unknown as SourceRow[]
  } catch (err) {
    wrapError(cfg, err)
  }
}

export const postgresDriver: SourceDriver = {
  engine: 'postgres',
  writable: true,

  async test(cfg) {
    await run(cfg, 'select 1', [])
  },

  async introspect(cfg, schema?): Promise<IntrospectedTable[]> {
    const schemaFilter = schema ?? cfg.default_schema
    const rows = await run(
      cfg,
      `select c.table_schema, c.table_name, c.column_name, c.data_type,
              c.character_maximum_length, c.is_nullable, c.column_default,
              c.ordinal_position,
              (pk.column_name is not null) as is_pk,
              pk.pk_size
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
        and t.table_type = 'BASE TABLE'
       left join (
         select kcu.table_schema, kcu.table_name, kcu.column_name,
                count(*) over (partition by kcu.table_schema, kcu.table_name) as pk_size
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_catalog = tc.constraint_catalog
          and kcu.constraint_schema = tc.constraint_schema
          and kcu.constraint_name = tc.constraint_name
          and kcu.table_schema = tc.table_schema
          and kcu.table_name = tc.table_name
         where tc.constraint_type = 'PRIMARY KEY'
       ) pk on pk.table_schema = c.table_schema and pk.table_name = c.table_name
          and pk.column_name = c.column_name
       where c.table_schema not in ('pg_catalog', 'information_schema')
         and ($1::text is null or c.table_schema = $1)
       order by c.table_schema, c.table_name, c.ordinal_position`,
      [schemaFilter ?? null],
    )
    // FK edges, same alias shape the mysql driver produces; composite FKs
    // (which fan out N×N through constraint_column_usage) are dropped by the
    // shared single-column grouping.
    const fkRows = await run(
      cfg,
      `select tc.constraint_schema, tc.constraint_name,
              kcu.table_schema, kcu.table_name, kcu.column_name,
              ccu.table_schema as referenced_table_schema,
              ccu.table_name as referenced_table_name,
              ccu.column_name as referenced_column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_schema = tc.constraint_schema
        and kcu.constraint_name = tc.constraint_name
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_schema = tc.constraint_schema
        and ccu.constraint_name = tc.constraint_name
       where tc.constraint_type = 'FOREIGN KEY'
         and kcu.table_schema not in ('pg_catalog', 'information_schema')
         and ($1::text is null or kcu.table_schema = $1)
       order by tc.constraint_schema, tc.constraint_name, kcu.ordinal_position`,
      [schemaFilter ?? null],
    )
    const fks = singleColumnFks(fkRows)
    const tables = new Map<string, IntrospectedTable>()
    for (const r of rows) {
      const key = `${r.table_schema}.${r.table_name}`
      let t = tables.get(key)
      if (!t) {
        t = { schema: String(r.table_schema), table: String(r.table_name), pk: null, columns: [] }
        tables.set(key, t)
      }
      const isPk = Boolean(r.is_pk)
      if (isPk) t.pk = Number(r.pk_size) === 1 ? String(r.column_name) : null
      t.columns.push({
        name: String(r.column_name),
        data_type: String(r.data_type),
        nullable: r.is_nullable === 'YES',
        has_default: r.column_default != null,
        is_pk: isPk,
        max_length: r.character_maximum_length == null ? null : Number(r.character_maximum_length),
        column_type: mapPgType(String(r.data_type), r.character_maximum_length as number | null),
        references:
          fks.get(fkKey(String(r.table_schema), String(r.table_name), String(r.column_name))) ??
          null,
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
      `select * from ${relation(bind)} where ${quoteIdent(bind.pk)}::text = $1`,
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
      `select ${quoteIdent(column)}::text as label, count(*)::int as value
       from ${relation(bind)} where ${text}
       group by ${quoteIdent(column)} order by value desc, label asc`,
      values,
    )
    return rows.map((r) => ({ label: String(r.label ?? ''), value: Number(r.value) }))
  },

  async insert(bind, values, pkValue) {
    const entries = Object.entries(values)
    if (pkValue != null) entries.unshift([bind.pk, pkValue])
    const cols = entries.map(([c]) => quoteIdent(c)).join(', ')
    const ph = entries.map((_, i) => `$${i + 1}`).join(', ')
    const rows = await run(
      bind.source,
      entries.length
        ? `insert into ${relation(bind)} (${cols}) values (${ph}) returning *`
        : `insert into ${relation(bind)} default values returning *`,
      entries.map(([, v]) => v),
    )
    return rows[0]
  },

  async update(bind, pk, values, expectModified) {
    const entries = Object.entries(values).filter(([c]) => c !== bind.modified)
    const sets = entries.map(([c], i) => `${quoteIdent(c)} = $${i + 1}`)
    const params: unknown[] = entries.map(([, v]) => v)
    // The revision must ADVANCE on every Featherbase write — a plain
    // DEFAULT now() column changes only on insert, so without this two Desk
    // editors would silently overwrite each other (review finding 3). This
    // also makes the empty payload go through the same statement, so its
    // revision check still runs.
    if (bind.modified) sets.push(`${quoteIdent(bind.modified)} = now()`)
    if (!sets.length) {
      const row = await this.getDoc(bind, pk)
      return row ?? 'missing'
    }
    let where = `${quoteIdent(bind.pk)}::text = $${params.length + 1}`
    params.push(pk)
    if (bind.modified && expectModified != null) {
      // CLI-written rows carry microsecond timestamps; the client's echo is
      // millisecond ISO. Compare at millisecond precision or every edit of a
      // CLI-written row would false-conflict.
      where += ` and date_trunc('milliseconds', ${quoteIdent(bind.modified)}) = date_trunc('milliseconds', $${params.length + 1}::timestamptz)`
      params.push(expectModified)
    }
    const rows = await run(
      bind.source,
      `update ${relation(bind)} set ${sets.join(', ')} where ${where} returning *`,
      params,
    )
    if (rows[0]) return rows[0]
    const still = await this.getDoc(bind, pk)
    return still ? 'conflict' : 'missing'
  },

  async remove(bind, pk, expectModified) {
    const params: unknown[] = [pk]
    let where = `${quoteIdent(bind.pk)}::text = $1`
    if (bind.modified && expectModified != null) {
      where += ` and date_trunc('milliseconds', ${quoteIdent(bind.modified)}) = date_trunc('milliseconds', $2::timestamptz)`
      params.push(expectModified)
    }
    const rows = await run(
      bind.source,
      `delete from ${relation(bind)} where ${where} returning ${quoteIdent(bind.pk)}`,
      params,
    )
    if (rows[0]) return
    const still = await this.getDoc(bind, pk)
    return still ? 'conflict' : 'missing'
  },

  dispose(sourceName) {
    const p = pools.get(sourceName)
    pools.delete(sourceName)
    void p?.end({ timeout: 1 }).catch(() => {})
  },
}

// EDS-2: proposed Featherbase column type per Postgres data type. Read side
// accepts anything; the write side's zod schema is what these choices gate.
function mapPgType(dataType: string, maxLength: number | null): string {
  switch (dataType) {
    case 'smallint':
    case 'integer':
    case 'bigint':
      return 'Int'
    case 'numeric':
    case 'real':
    case 'double precision':
      return 'Float'
    case 'boolean':
      return 'Check'
    case 'date':
      return 'Date'
    case 'timestamp without time zone':
    case 'timestamp with time zone':
      return 'Datetime'
    case 'json':
    case 'jsonb':
      return 'JSON'
    case 'uuid':
      return 'Data'
    case 'character varying':
    case 'character':
      return maxLength != null && maxLength <= 140 ? 'Data' : 'Text'
    default:
      return 'Text'
  }
}
