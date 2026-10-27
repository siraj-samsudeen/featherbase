import mysql from 'mysql2'
import { readNamedVariable } from '../env'
import type { Pool } from 'mysql2/promise'
import { AppError } from '../errors'
import { fkKey, singleColumnFks } from './fk'
import { REFUSAL_CODE } from './types'
import type {
  Binding,
  IntrospectedTable,
  ListSpec,
  SourceConfig,
  SourceDriver,
  SourceFilter,
  SourceRefusal,
  SourceRow,
} from './types'

// The mysql driver (mysql2, which speaks caching_sha2_password). One bounded
// pool per source (EDS-1), every identifier quoted, every value a bound
// parameter (IV2/IV4). Dialect differences with the postgres driver stay
// INSIDE this file — same seam, different adapter: `?` placeholders,
// backtick quoting, `<=>` for null-safe equality, and no RETURNING (writes
// re-select the row through the pk instead, inside the write's own
// transaction — see `inTransaction`).

const pools = new Map<string, Pool>()

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
// MySQL speaks errno, not SQLSTATE — translate each constraint errno into the
// shared refusal shape (types.ts) so connected-table saves explain them
// field-wise exactly as they do for a Postgres source.
//   1062 ER_DUP_ENTRY:            Duplicate entry 'acme' for key 'tenant.slug'
//   1048 ER_BAD_NULL_ERROR:       Column 'status' cannot be null
//   1364 ER_NO_DEFAULT_FOR_FIELD: Field 'status' doesn't have a default value
//   1452 / 1451:                  a foreign key fails on a save / on a delete
//   3819 ER_CHECK_CONSTRAINT_VIOLATED: Check constraint 'gauge_level_range' is violated.
//   1406 / 1264 / 1366 / 1292 / 1265: too long / out of range / incorrect or
//                                 truncated value ... for column 'level'
// (1292 is also strict mode's answer to a malformed id in a WHERE clause;
// the save path looks the row up first, which only warns, so it never gets
// that far.)
const NOT_NULL = new Set([1048, 1364])
const BAD_VALUE = new Set([1264, 1366, 1292, 1265])

function refusal(e: { errno?: number; message?: string }): SourceRefusal | null {
  const message = e.message ?? ''
  const shaped = (code: SourceRefusal['code'], extra: Partial<SourceRefusal> = {}) =>
    Object.assign(new Error(message || 'the data source refused the write'), { code, ...extra }) as SourceRefusal
  const quoted = (re: RegExp) => re.exec(message)?.[1]
  const column = (name: string | undefined) => (name ? { column_name: name } : {})
  const errno = e.errno ?? 0
  if (errno === 1062) {
    const m = /Duplicate entry '(.*)' for key '(?:[^'.]+\.)?([^']+)'/.exec(message)
    // A single-column unique index is named after its column by default; the
    // PRIMARY key names no column, and the dispatcher then blames the row id.
    return shaped(REFUSAL_CODE.unique, m && m[2] !== 'PRIMARY' ? { detail: `Key (${m[2]})=(${m[1]}) already exists.` } : {})
  }
  if (NOT_NULL.has(errno))
    return shaped(REFUSAL_CODE.notNull, column(quoted(/^(?:Column|Field) '([^']+)'/)))
  if (errno === 1452) {
    const constraint = quoted(/CONSTRAINT `([^`]+)`/)
    return shaped(REFUSAL_CODE.foreignKey, {
      ...column(quoted(/FOREIGN KEY \(`([^`]+)`\)/)),
      ...(constraint ? { constraint_name: constraint } : {}),
    })
  }
  // 1451: this row is the one pointed at. Its own column is the one after
  // REFERENCES; the detail says which way round it is, in Postgres's words.
  if (errno === 1451) {
    const referenced = quoted(/REFERENCES `[^`]+` \(`([^`]+)`\)/)
    return shaped(REFUSAL_CODE.foreignKey, {
      ...column(referenced),
      detail: `Key (${referenced ?? '?'}) is still referenced from another table.`,
    })
  }
  if (errno === 3819) {
    const constraint = quoted(/constraint '([^']+)'/i)
    return shaped(REFUSAL_CODE.check, constraint ? { constraint_name: constraint } : {})
  }
  if (errno === 1406) return shaped(REFUSAL_CODE.tooLong, column(quoted(/for column '([^']+)'/)))
  if (BAD_VALUE.has(errno)) return shaped(REFUSAL_CODE.outOfRange, column(quoted(/for column '([^']+)'/)))
  return null
}

function wrapError(cfg: SourceConfig, err: unknown): never {
  if (err instanceof AppError) throw err
  const e = err as { errno?: number; message?: string }
  const refused = e ? refusal(e) : null
  if (refused) throw refused
  const message = e?.message ?? String(err)
  const secret = cfg.url_env ? readNamedVariable(cfg.url_env) : undefined
  const pwd = secret ? /^[a-z+]+:\/\/[^:/@]+:([^@]+)@/i.exec(secret)?.[1] : undefined
  let scrubbed = secret ? message.split(secret).join(`$${cfg.url_env}`) : message
  if (pwd) scrubbed = scrubbed.split(pwd).join('****')
  throw new AppError('DataSourceError', `Data source ${cfg.name} failed: ${scrubbed}`)
}

// One statement, through whatever runs it: the pool (autocommit) or the
// connection holding a write's transaction.
type Querier = { query: Pool['query'] }

async function run(
  cfg: SourceConfig,
  text: string,
  values: unknown[],
  on: Querier = pool(cfg),
): Promise<SourceRow[]> {
  try {
    const [rows] = await on.query(text, values)
    return rows as SourceRow[]
  } catch (err) {
    wrapError(cfg, err)
  }
}

async function exec(
  cfg: SourceConfig,
  text: string,
  values: unknown[],
  on: Querier,
  // update/delete by key: an id the key can't hold matches no row.
  matchesKey = false,
): Promise<{ affectedRows: number; insertId: number }> {
  try {
    const statement = () => on.query(text, values)
    const [result] = matchesKey
      ? await byKey(statement, [{ affectedRows: 0, insertId: 0 }] as never)
      : await statement()
    return result as { affectedRows: number; insertId: number }
  } catch (err) {
    wrapError(cfg, err)
  }
}

// #155: MySQL has no RETURNING, so a write is a statement plus a re-read.
// These guarantees hold for tables that support transactions (InnoDB, the
// default); a MyISAM table has neither row locks nor rollback (#566 lists
// the follow-up).
// Both run on one pooled connection in one transaction: the statement's row
// lock holds until the re-read, so the row handed back is the one this save
// wrote — never another writer's change landing in between, and never
// 'missing' because someone deleted it in between. A failure (or a throw from
// `work`, such as a new row that can't be found again) rolls the write back.
async function inTransaction<T>(cfg: SourceConfig, work: (conn: Querier) => Promise<T>): Promise<T> {
  let conn: Awaited<ReturnType<Pool['getConnection']>>
  let result: T
  try {
    conn = await pool(cfg).getConnection()
  } catch (err) {
    wrapError(cfg, err)
  }
  try {
    await conn.beginTransaction().catch((err) => wrapError(cfg, err))
    // `work` runs its statements through run/exec, which shape their own errors.
    result = await work(conn)
    await conn.commit().catch((err) => wrapError(cfg, err))
  } catch (err) {
    // A connection that can't roll back may still hold the transaction and
    // its locks: close it rather than hand it to the next caller.
    await conn.rollback().then(() => conn.release(), () => conn.destroy())
    throw err
  }
  conn.release()
  return result
}

// The row whose key, as text, is exactly `pk`. `key = ?` lets MySQL find it
// through the primary key's index, so a write's transaction locks that row
// and no other; the text comparison then refuses near misses MySQL's own
// conversion would accept ('1abc' = 1). Two placeholders, both the pk.
function pkMatch(bind: Binding): string {
  const key = quoteIdent(bind.pk)
  return `${key} = ? and cast(${key} as char) = ?`
}

function selectByPk(bind: Binding): string {
  return `select * from ${relation(bind)} where ${pkMatch(bind)} limit 1`
}

// ER_CANT_AGGREGATE_2COLLATIONS: the id holds a character the key's
// character set can't (an emoji against a latin1 key), so `key = ?` can't
// even be compared. Such an id names no row.
const KEY_CANNOT_HOLD = 1267

async function byKey<T>(statement: () => Promise<T>, noRow: T): Promise<T> {
  try {
    return await statement()
  } catch (err) {
    if ((err as { errno?: number })?.errno === KEY_CANNOT_HOLD) return noRow
    throw err
  }
}

async function readRow(bind: Binding, pk: string, on: Querier): Promise<SourceRow | null> {
  try {
    const [rows] = await byKey(() => on.query(selectByPk(bind), [pk, pk]), [[]] as never)
    return (rows as SourceRow[])[0] ?? null
  } catch (err) {
    wrapError(bind.source, err)
  }
}

// The client echoes updated_at as millisecond ISO; DATETIME columns store
// second or microsecond precision. Both sides are cut to the same whole
// millisecond and compared for equality (postgres: date_trunc('milliseconds',
// ...) on both sides) — a write stamped a fraction of a millisecond away, in
// a different millisecond, is a change.
function modifiedMatch(bind: Binding): string {
  const ms = (expr: string) => `left(date_format(${expr}, '%Y-%m-%d %H:%i:%s.%f'), 23)`
  return `${ms(quoteIdent(bind.modified!))} = ${ms('?')}`
}

async function keyIsAutoIncrement(bind: Binding): Promise<boolean> {
  const rows = await run(
    bind.source,
    `select extra as extra from information_schema.columns
     where table_schema = coalesce(?, database()) and table_name = ? and column_name = ?`,
    [bind.schema ?? null, bind.table, bind.pk],
  )
  return String(rows[0]?.extra ?? '').toLowerCase().includes('auto_increment')
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
    // FK edges: every column that participates in a foreign key, with its
    // referenced relation. Composite FKs are grouped in JS and dropped —
    // only a single-column FK can ever become a Reference.
    const fkRows = await run(
      cfg,
      `select kcu.constraint_schema as constraint_schema,
              kcu.constraint_name as constraint_name,
              kcu.table_schema as table_schema, kcu.table_name as table_name,
              kcu.column_name as column_name,
              kcu.referenced_table_schema as referenced_table_schema,
              kcu.referenced_table_name as referenced_table_name,
              kcu.referenced_column_name as referenced_column_name
       from information_schema.key_column_usage kcu
       where kcu.referenced_table_name is not null
         and kcu.table_schema not in ('mysql', 'information_schema', 'performance_schema', 'sys')
         and (? is null or kcu.table_schema = ?)
       order by kcu.constraint_schema, kcu.constraint_name, kcu.ordinal_position`,
      [schemaFilter, schemaFilter],
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
      `select count(*) as count from ${relation(bind)} where ${text}`,
      values,
    )
    return { rows, total: Number(count) }
  },

  async getDoc(bind, pk) {
    return readRow(bind, pk, pool(bind.source))
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
    // A row that can't be read back is rolled back rather than left behind.
    // Without a given key, only an auto_increment KEY can be read back: the
    // insert id may belong to another auto_increment column. Refuse before
    // writing, so nothing is left behind even on a table with no transactions.
    if (pkValue == null && !(await keyIsAutoIncrement(bind)))
      throw new AppError(
        'DataSourceError',
        `Data source ${bind.source.name}: a new row in ${bind.table} needs its key given, or Featherbase cannot address it — the primary key has no auto_increment`,
      )
    return inTransaction(bind.source, async (conn) => {
      const result = await exec(
        bind.source,
        entries.length
          ? `insert into ${relation(bind)} (${cols}) values (${ph})`
          : `insert into ${relation(bind)} () values ()`,
        entries.map(([, v]) => v),
        conn,
      )
      const key = pkValue ?? (result.insertId ? String(result.insertId) : null)
      if (key == null)
        throw new AppError(
          'DataSourceError',
          `Data source ${bind.source.name}: inserted a row into ${bind.table} but cannot address it — the database gave it no number`,
        )
      const row = await readRow(bind, String(key), conn)
      if (!row)
        throw new AppError(
          'DataSourceError',
          `Data source ${bind.source.name}: inserted row ${key} not found on re-read`,
        )
      return row
    })
  },

  async update(bind, pk, values, expectModified) {
    const entries = Object.entries(values).filter(([c]) => c !== bind.modified)
    const sets = entries.map(([c]) => `${quoteIdent(c)} = ?`)
    const params: unknown[] = entries.map(([, v]) => v)
    // The revision must ADVANCE on every Featherbase write (same rationale as
    // the postgres driver); now(3) carries millisecond precision so two
    // same-second saves still conflict.
    if (bind.modified) sets.push(`${quoteIdent(bind.modified)} = now(3)`)
    if (!sets.length) return (await this.getDoc(bind, pk)) ?? 'missing'
    let where = pkMatch(bind)
    params.push(pk, pk)
    if (bind.modified && expectModified != null) {
      where += ` and ${modifiedMatch(bind)}`
      params.push(new Date(expectModified))
    }
    return inTransaction(bind.source, async (conn) => {
      const result = await exec(
        bind.source,
        `update ${relation(bind)} set ${sets.join(', ')} where ${where}`,
        params,
        conn,
        true,
      )
      const row = await readRow(bind, pk, conn)
      if (result.affectedRows === 0) return row ? 'conflict' : 'missing'
      // Something at the source (a trigger) moved the key: undo the write
      // rather than report a saved row as missing.
      if (!row)
        throw new AppError(
          'DataSourceError',
          `Data source ${bind.source.name}: updated row ${pk} not found on re-read`,
        )
      return row
    })
  },

  async remove(bind, pk, expectModified) {
    const params: unknown[] = [pk, pk]
    let where = pkMatch(bind)
    if (bind.modified && expectModified != null) {
      where += ` and ${modifiedMatch(bind)}`
      params.push(new Date(expectModified))
    }
    return inTransaction(bind.source, async (conn) => {
      const result = await exec(bind.source, `delete from ${relation(bind)} where ${where}`, params, conn, true)
      if (result.affectedRows > 0) return
      return (await readRow(bind, pk, conn)) ? 'conflict' : 'missing'
    })
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
