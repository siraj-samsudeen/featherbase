import { AppError, errorMessage } from '../errors'
import { datasetQueryText } from './dataset-query'
import { readNamedVariable } from '../env'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { attachStatement } from '../motherduck-reader'
import { instanceToken, openSourceSession } from './motherduck'
import type {
  Binding,
  IntrospectedTable,
  ListSpec,
  SourceConfig,
  SourceDriver,
  SourceFilter,
  SourceRow,
} from './types'
import { orderClause } from './order'

// M3: the duckdb/MotherDuck driver — strictly read-only (the warehouse
// browser). A MotherDuck source uses the instance's MOTHERDUCK_TOKEN; a duckdb
// source is a local .duckdb file, its path in the env var named by url_env
// (or a folder of <name>.duckdb files when the source names databases, #1123).
// @duckdb/node-api 1.5.6-r.2 (DuckDB 1.5.6) passed real MotherDuck connection,
// introspection and read-only warehouse query checks on 1-Nov-2026 (#747).
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
  close?: () => void
  secret?: string
}
interface CachedInstance {
  key: string
  ready: Promise<InstanceEntry>
  readers: number
  retired: boolean
}
const instances = new Map<string, CachedInstance>()

function closeUnused(entry: CachedInstance) {
  if (entry.retired && entry.readers === 0)
    void entry.ready.then(e => e.close ? e.close() : e.instance.closeSync()).catch(() => {})
}

function retire(entry: CachedInstance) {
  entry.retired = true
  closeUnused(entry)
}

function requireUrl(cfg: SourceConfig): string {
  if (!cfg.url_env)
    throw new AppError('ValidationError', `Data source ${cfg.name} has no url_env configured`)
  const value = readNamedVariable(cfg.url_env)
  if (!value)
    throw new AppError(
      'ValidationError',
      `Environment variable ${cfg.url_env} is not set (required by data source ${cfg.name})`,
    )
  return value
}

// #625: every path through this driver only reads (it has no write path), so
// one instance per source serves them all, and a local file is opened with
// DuckDB's READ_ONLY access mode: browsing, testing the connection and an
// app's dataset query share it, and any write (nextval included) is refused.
// One instance per file, one setting, so DuckDB never meets the same file
// opened twice with different settings.
//
// #969: a MotherDuck address cannot be opened read-only, so it is refused here:
// the only way to MotherDuck is a motherduck source, whose session attaches its
// databases read-only (ADR 0020).
function localFile(cfg: SourceConfig): string {
  const url = requireUrl(cfg)
  if (/^\s*(md|motherduck):/i.test(url))
    throw new AppError('ValidationError', `Data source ${cfg.name} is a DuckDB file source, but ${cfg.url_env} holds a MotherDuck address. Use a MotherDuck source, which reads MOTHERDUCK_TOKEN.`)
  return url
}

// #969: the session key is the token plus the chosen databases, so a new token
// or new databases open a fresh session.
function motherDuckCredentials(cfg: SourceConfig): { token: string; key: string } {
  // Without this, Test Connection would pass and every table read would then fail.
  if (!cfg.databases.length)
    throw new AppError('ValidationError', `Data source ${cfg.name} reads no database yet; name the databases it reads`)
  const token = instanceToken()
  return { token, key: `${token}|${JSON.stringify(cfg.databases.map((d) => d.name))}` }
}

// #1123: a duckdb source that names databases points url_env at a folder; each
// database is the file <name>.duckdb there, attached read-only under its name in
// an in-memory instance, so "gold"."masters"."store" and "marts"."sales"."daily"
// meet in one query. The key carries the names, so a new list opens afresh.
interface WarehouseFolder { folder: string; files: { name: string; file: string }[] }
function warehouseFolder(cfg: SourceConfig, folder: string): WarehouseFolder | null {
  if (cfg.engine !== 'duckdb' || !cfg.databases.length) return null
  const files = cfg.databases.map(({ name }) => {
    if (!/^[A-Za-z0-9_]+$/.test(name))
      throw new AppError('ValidationError', `Data source ${cfg.name}: database name ${JSON.stringify(name)} must use only letters, digits and underscores`)
    const file = path.join(folder, `${name}.duckdb`)
    if (!existsSync(file))
      throw new AppError('ValidationError', `Data source ${cfg.name}: database "${name}" has no file ${name}.duckdb in its folder`)
    return { name, file }
  })
  return { folder, files }
}

async function openFolder({ DuckDBInstance }: DuckDBModule, { folder, files }: WarehouseFolder): Promise<InstanceEntry> {
  const instance = await DuckDBInstance.create(':memory:')
  try {
    const conn = await instance.connect()
    try { for (const { name, file } of files) await conn.run(attachStatement(file, name)) }
    finally { conn.closeSync() }
  } catch (err) {
    instance.closeSync()
    throw err
  }
  return { instance, secret: folder }
}

async function instanceFor(cfg: SourceConfig): Promise<InstanceEntry & { release(): void }> {
  const credentials = cfg.engine === 'motherduck' ? motherDuckCredentials(cfg) : null
  const file = credentials ? null : localFile(cfg)
  const folder = file === null ? null : warehouseFolder(cfg, file)
  const key = credentials?.key ?? (folder ? `${file}|${JSON.stringify(folder.files.map((f) => f.name))}` : file!)
  let cached = instances.get(cfg.name)
  // No await between observing the key and publishing the in-flight open.
  // Replaced sessions drain their readers instead of closing live connections.
  if (!cached || cached.key !== key) {
    if (cached) retire(cached)
    const ready = credentials
      ? openSourceSession(credentials.token, cfg.databases).then(session => ({ instance: session.instance, secret: credentials.token, close: () => session.close() }))
      : folder
        ? loadDuckdb().then(duckdb => openFolder(duckdb, folder))
        : loadDuckdb().then(async ({ DuckDBInstance }) => ({ instance: await DuckDBInstance.create(key, { access_mode: 'READ_ONLY' }), secret: key }))
    cached = { key, ready, readers: 0, retired: false }
    instances.set(cfg.name, cached)
  }
  const lease = cached
  lease.readers++
  const release = () => { lease.readers--; closeUnused(lease) }
  try { return { ...await lease.ready, release } }
  catch (error) {
    release()
    // An old failed open must never evict a newer replacement.
    if (instances.get(cfg.name) === lease) {
      instances.delete(cfg.name)
      retire(lease)
    }
    wrapError(cfg, error, credentials?.token)
  }
}

function wrapError(cfg: SourceConfig, err: unknown, secret?: string): never {
  if (err instanceof AppError) throw err
  const message = errorMessage(err)
  secret ??= cfg.url_env ? readNamedVariable(cfg.url_env) : undefined
  throw new AppError(
    'DataSourceError',
    `Data source ${cfg.name} failed: ${secret ? message.split(secret).join(cfg.engine === 'motherduck' ? '[token]' : `$${cfg.url_env}`) : message}`,
  )
}

// JSON-safe rows: getRowObjectsJson() renders BIGINT/DECIMAL as strings and
// DATE/TIMESTAMP as ISO-ish strings — exactly what the read-only Admin needs.
export async function run(cfg: SourceConfig, text: string, params: unknown[]): Promise<SourceRow[]> {
  let lease: Awaited<ReturnType<typeof instanceFor>> | undefined
  try {
    lease = await instanceFor(cfg)
    const conn = await lease.instance.connect()
    try {
      const reader = await conn.runAndReadAll(text, params as never[])
      return reader.getRowObjectsJson() as SourceRow[]
    } finally {
      conn.closeSync()
    }
  } catch (err) {
    return wrapError(cfg, err, lease?.secret)
  } finally { lease?.release() }
}

/** One source observation, fetched in native chunks instead of materializing
 * the whole warehouse in JavaScript. Closing also handles an aborted caller. */
export async function* stream(cfg: SourceConfig, text: string): AsyncGenerator<SourceRow[]> {
  let lease: Awaited<ReturnType<typeof instanceFor>> | undefined
  try {
    lease = await instanceFor(cfg)
    const conn = await lease.instance.connect()
    try {
      const result = await conn.stream(text)
      try {
        const names = result.columnNames()
        const { JsonDuckDBValueConverter } = await loadDuckdb()
        for await (const chunk of result) {
          yield chunk.convertRows(JsonDuckDBValueConverter).map(values => Object.fromEntries(names.map((name, i) => [name, values[i]])))
        }
      } finally { result.closeSync() }
    } finally { conn.closeSync() }
  } catch (err) { wrapError(cfg, err, lease?.secret) }
  finally { lease?.release() }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}
export const quoteIdentifier = quoteIdent

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
      case 'related':
        throw new AppError('ValidationError', 'Related filters are not supported by this source engine')
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

  // #625: an app's dataset query (MotherDuck in production). Wrapped as a
  // sub-query, on a session that holds its databases read-only.
  async query(cfg, query, columns, where) {
    const { text, values } = datasetQueryText(query, columns, where,
      { placeholder: () => '?', asText: (column) => `cast(${column} as varchar)`, asDay: (column) => `cast(cast(${column} as date) as varchar)` })
    return run(cfg, text, values)
  },

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
    const order = orderClause(spec.order, bind.pk, quoteIdent)
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
    if (entry) retire(entry)
  },
}

export function mapDuckType(dataType: string): string {
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
