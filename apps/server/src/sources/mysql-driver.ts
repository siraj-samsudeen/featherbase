import mysql from 'mysql2'
import type { Pool } from 'mysql2/promise'
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

// The mysql driver (mysql2, which speaks caching_sha2_password). One bounded
// pool per source (EDS-1), every identifier quoted, every value a bound
// parameter (IV2/IV4). Dialect differences with the postgres driver stay
// INSIDE this file — same seam, different adapter: `?` placeholders,
// backtick quoting, `<=>` for null-safe equality, and no RETURNING (writes
// re-select the row through the pk instead).

const pools = new Map<string, Pool>()

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

// mysql:// URL → pool config. TLS rides the query string the way the mysql
// CLI spells it: ?sslmode=REQUIRED (encrypt, no CA check — the right default
// for RDS without its CA bundle), VERIFY_CA / VERIFY_IDENTITY (verify), or
// plain ?ssl=true (same as REQUIRED).
function parseUrl(cfg: SourceConfig, raw: string): mysql.PoolOptions {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new AppError('ValidationError', `$${cfg.url_env} is not a valid mysql:// URL`)
  }
  const sslmode = (u.searchParams.get('sslmode') ?? u.searchParams.get('ssl-mode') ?? '')
    .toUpperCase()
  const sslFlag = (u.searchParams.get('ssl') ?? '').toLowerCase()
  const ssl =
    sslmode === 'VERIFY_CA' || sslmode === 'VERIFY_IDENTITY'
      ? { rejectUnauthorized: true }
      : sslmode === 'REQUIRED' || sslmode === 'PREFERRED' || sslFlag === 'true' || sslFlag === '1'
        ? { rejectUnauthorized: false }
        : undefined
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    ...(ssl ? { ssl } : {}),
  }
}

function pool(cfg: SourceConfig): Pool {
  const cached = pools.get(cfg.name)
  if (cached) return cached
  const base = mysql.createPool({
    ...parseUrl(cfg, requireUrl(cfg)),
    connectionLimit: cfg.pool_max,
    connectTimeout: 10_000,
    // DATETIME has no zone; pin the session to UTC so a value round-trips
    // through JS Dates (serialized as ISO in API rows) unchanged.
    timezone: 'Z',
    supportBigNumbers: true,
    // FOUND_ROWS: update reports MATCHED rows, not changed rows — without it
    // a no-op update of identical values would masquerade as a conflict.
    flags: ['FOUND_ROWS'],
  })
  // MAX_EXECUTION_TIME is MySQL's only statement timeout (SELECT-only, ms).
  base.on('connection', (conn) => {
    conn.query(`SET SESSION MAX_EXECUTION_TIME = ${Math.floor(cfg.statement_timeout_ms)}`)
  })
  const client = base.promise()
  pools.set(cfg.name, client)
  return client
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function relation(bind: Binding): string {
  // MySQL schema == database; the pool is already connected to one, but the
  // binding's schema is authoritative (introspection reports it).
  return bind.schema ? `${quoteIdent(bind.schema)}.${quoteIdent(bind.table)}` : quoteIdent(bind.table)
}

// WHERE builder: SQL text with ? placeholders plus the value list.
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
        // <=> is MySQL's null-safe equality (postgres: is distinct from).
        parts.push(`not (${col} <=> ?)`)
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
        parts.push(`lower(cast(${col} as char)) like lower(?)`)
        values.push(f.value)
        break
      case 'not like':
        parts.push(`lower(cast(${col} as char)) not like lower(?)`)
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

// EDS-11: name the source in every failure instead of leaking driver noise.
// MySQL speaks errno, not SQLSTATE class 23/22 the way mapDbError in
// document.ts reads it — translate the constraint errnos into the
// postgres-shaped codes so field-wise errors work identically.
//   1062 ER_DUP_ENTRY:  "Duplicate entry 'acme' for key 'tenant.slug'"
//   1264/1406/1366: value out of range / data too long / incorrect value
function wrapError(cfg: SourceConfig, err: unknown): never {
  if (err instanceof AppError) throw err
  const e = err as { errno?: number; message?: string }
  if (e?.errno === 1062) {
    const m = /Duplicate entry '(.*)' for key '(?:[^'.]+\.)?([^']+)'/.exec(e.message ?? '')
    // A single-column unique index is named after its column by default;
    // mapDbError falls back to blaming `name` when the shape doesn't match —
    // the same fallback the postgres path has for exotic constraint names.
    const shaped = new Error(e.message ?? 'duplicate key') as Error & {
      code: string
      detail?: string
    }
    shaped.code = '23505'
    if (m && m[2] !== 'PRIMARY') shaped.detail = `Key (${m[2]})=(${m[1]}) already exists.`
    throw shaped
  }
  if (e?.errno === 1264 || e?.errno === 1406 || e?.errno === 1366) {
    const shaped = new Error(e.message ?? 'value out of range') as Error & { code: string }
    shaped.code = e.errno === 1406 ? '22001' : '22003'
    throw shaped
  }
  const message = e?.message ?? String(err)
  const secret = cfg.url_env ? process.env[cfg.url_env] : undefined
  const pwd = secret ? /^[a-z+]+:\/\/[^:/@]+:([^@]+)@/i.exec(secret)?.[1] : undefined
  let scrubbed = secret ? message.split(secret).join(`$${cfg.url_env}`) : message
  if (pwd) scrubbed = scrubbed.split(pwd).join('****')
  throw new AppError('DataSourceError', `Data source ${cfg.name} failed: ${scrubbed}`)
}

async function run(cfg: SourceConfig, text: string, values: unknown[]): Promise<SourceRow[]> {
  try {
    const [rows] = await pool(cfg).query(text, values)
    return rows as SourceRow[]
  } catch (err) {
    wrapError(cfg, err)
  }
}

async function exec(
  cfg: SourceConfig,
  text: string,
  values: unknown[],
): Promise<{ affectedRows: number; insertId: number }> {
  try {
    const [result] = await pool(cfg).query(text, values)
    return result as { affectedRows: number; insertId: number }
  } catch (err) {
    wrapError(cfg, err)
  }
}

// The client echoes updated_at as millisecond ISO; DATETIME columns store
// second or microsecond precision. Compare within the same millisecond
// (postgres: date_trunc('milliseconds', ...) on both sides).
function modifiedMatch(bind: Binding): string {
  return `abs(timestampdiff(microsecond, ${quoteIdent(bind.modified!)}, ?)) < 1000`
}

export const mysqlDriver: SourceDriver = {
  engine: 'mysql',
  writable: true,

  async test(cfg) {
    await run(cfg, 'select 1', [])
  },

  async introspect(cfg, schema?): Promise<IntrospectedTable[]> {
    const schemaFilter = schema ?? cfg.default_schema ?? null
    const rows = await run(
      cfg,
      `select c.table_schema as table_schema, c.table_name as table_name,
              c.column_name as column_name, c.data_type as data_type,
              c.column_type as column_type,
              c.character_maximum_length as character_maximum_length,
              c.is_nullable as is_nullable, c.column_default as column_default,
              c.extra as extra,
              (c.column_key = 'PRI') as is_pk,
              pk.pk_size as pk_size
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
        and t.table_type = 'BASE TABLE'
       left join (
         select table_schema, table_name, count(*) as pk_size
         from information_schema.key_column_usage
         where constraint_name = 'PRIMARY'
         group by table_schema, table_name
       ) pk on pk.table_schema = c.table_schema and pk.table_name = c.table_name
       where c.table_schema not in ('mysql', 'information_schema', 'performance_schema', 'sys')
         and (? is null or c.table_schema = ?)
       order by c.table_schema, c.table_name, c.ordinal_position`,
      [schemaFilter, schemaFilter],
    )
    const tables = new Map<string, IntrospectedTable>()
    for (const r of rows) {
      const key = `${r.table_schema}.${r.table_name}`
      let t = tables.get(key)
      if (!t) {
        t = { schema: String(r.table_schema), table: String(r.table_name), pk: null, columns: [] }
        tables.set(key, t)
      }
      const isPk = Boolean(Number(r.is_pk))
      if (isPk) t.pk = Number(r.pk_size) === 1 ? String(r.column_name) : null
      // AUTO_INCREMENT columns have a null column_default but the server
      // fills them — they count as defaulted for the reqd heuristic.
      const extra = String(r.extra ?? '').toLowerCase()
      t.columns.push({
        name: String(r.column_name),
        data_type: String(r.data_type),
        nullable: r.is_nullable === 'YES',
        has_default: r.column_default != null || extra.includes('auto_increment'),
        is_pk: isPk,
        max_length: r.character_maximum_length == null ? null : Number(r.character_maximum_length),
        column_type: mapMysqlType(
          String(r.data_type),
          String(r.column_type ?? ''),
          r.character_maximum_length == null ? null : Number(r.character_maximum_length),
        ),
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
      `select count(*) as count from ${relation(bind)} where ${text}`,
      values,
    )
    return { rows, total: Number(count) }
  },

  async getDoc(bind, pk) {
    const rows = await run(
      bind.source,
      `select * from ${relation(bind)} where cast(${quoteIdent(bind.pk)} as char) = ? limit 1`,
      [pk],
    )
    return rows[0] ?? null
  },

  async count(bind, filters) {
    const { text, values } = buildWhere(filters)
    const [{ count }] = await run(
      bind.source,
      `select count(*) as count from ${relation(bind)} where ${text}`,
      values,
    )
    return Number(count)
  },

  async groupCount(bind, column, filters) {
    const { text, values } = buildWhere(filters)
    const rows = await run(
      bind.source,
      `select cast(${quoteIdent(column)} as char) as label, count(*) as value
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
    const ph = entries.map(() => '?').join(', ')
    // No RETURNING in MySQL — insert, then read the row back through the pk
    // (LAST_INSERT_ID() for auto_increment keys, the given value otherwise).
    const result = await exec(
      bind.source,
      entries.length
        ? `insert into ${relation(bind)} (${cols}) values (${ph})`
        : `insert into ${relation(bind)} () values ()`,
      entries.map(([, v]) => v),
    )
    const key = pkValue ?? (result.insertId ? String(result.insertId) : null)
    if (key == null)
      throw new AppError(
        'DataSourceError',
        `Data source ${bind.source.name}: inserted a row into ${bind.table} but cannot address it — the primary key has no auto_increment and no value was given`,
      )
    const row = await this.getDoc(bind, String(key))
    if (!row)
      throw new AppError(
        'DataSourceError',
        `Data source ${bind.source.name}: inserted row ${key} not found on re-read`,
      )
    return row
  },

  async update(bind, pk, values, expectModified) {
    const entries = Object.entries(values).filter(([c]) => c !== bind.modified)
    const sets = entries.map(([c]) => `${quoteIdent(c)} = ?`)
    const params: unknown[] = entries.map(([, v]) => v)
    // The revision must ADVANCE on every Featherbase write (same rationale as
    // the postgres driver); now(3) carries millisecond precision so two
    // same-second saves still conflict.
    if (bind.modified) sets.push(`${quoteIdent(bind.modified)} = now(3)`)
    if (!sets.length) {
      const row = await this.getDoc(bind, pk)
      return row ?? 'missing'
    }
    let where = `cast(${quoteIdent(bind.pk)} as char) = ?`
    params.push(pk)
    if (bind.modified && expectModified != null) {
      where += ` and ${modifiedMatch(bind)}`
      params.push(new Date(expectModified))
    }
    const result = await exec(
      bind.source,
      `update ${relation(bind)} set ${sets.join(', ')} where ${where}`,
      params,
    )
    if (result.affectedRows > 0) {
      const row = await this.getDoc(bind, pk)
      return row ?? 'missing'
    }
    const still = await this.getDoc(bind, pk)
    return still ? 'conflict' : 'missing'
  },

  async remove(bind, pk, expectModified) {
    const params: unknown[] = [pk]
    let where = `cast(${quoteIdent(bind.pk)} as char) = ?`
    if (bind.modified && expectModified != null) {
      where += ` and ${modifiedMatch(bind)}`
      params.push(new Date(expectModified))
    }
    const result = await exec(bind.source, `delete from ${relation(bind)} where ${where}`, params)
    if (result.affectedRows > 0) return
    const still = await this.getDoc(bind, pk)
    return still ? 'conflict' : 'missing'
  },

  dispose(sourceName) {
    const p = pools.get(sourceName)
    pools.delete(sourceName)
    void p?.end().catch(() => {})
  },
}

// EDS-2: proposed Featherbase column type per MySQL data type. column_type
// (the full spelling) is needed for one case: tinyint(1) is MySQL's boolean.
function mapMysqlType(dataType: string, columnType: string, maxLength: number | null): string {
  switch (dataType) {
    case 'tinyint':
      return columnType.startsWith('tinyint(1)') ? 'Check' : 'Int'
    case 'smallint':
    case 'mediumint':
    case 'int':
    case 'bigint':
    case 'year':
      return 'Int'
    case 'decimal':
    case 'float':
    case 'double':
      return 'Float'
    case 'date':
      return 'Date'
    case 'datetime':
    case 'timestamp':
      return 'Datetime'
    case 'json':
      return 'JSON'
    case 'enum':
    case 'set':
      return 'Data'
    case 'char':
    case 'varchar':
      return maxLength != null && maxLength <= 140 ? 'Data' : 'Text'
    default:
      return 'Text'
  }
}
