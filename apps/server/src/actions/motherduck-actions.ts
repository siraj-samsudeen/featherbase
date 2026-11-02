// #772: a MotherDuck source connected by pasting its token (ADR 0018, design D1–D3).
//   POST /api/table/Data Source:motherduck_test     { token }
//   POST /api/table/Data Source:motherduck_connect  { name, token, databases }
//   POST /api/table/Data Source/<name>:replace_token { token }
//   GET  /api/table/Data Source/<name>:tables?database=
//   POST /api/table/Data Source/<name>:refresh_tables { database }
//   GET  /api/table/Data Source/<name>:preview?database=&schema=&table=
// Every action is System Manager only. A token is never returned or logged; the
// source keeps it encrypted in data_source_secret and shows only its last four.
import { AppError } from '../errors'
import { registerCollectionAction, registerRowAction } from '../actions'
import { actionTransaction } from '../action-transaction'
import { sql } from '../db'
import { saveDoc } from '../document'
import { assertSystemManager } from '../permissions'
import { encryptSecret, lastFour } from '../secret-store'
import { getSource, invalidateSources } from '../sources/registry'
import { run, quoteIdentifier } from '../sources/duckdb-driver'
import { inspectToken, type WarehouseDatabase } from '../sources/motherduck'
import type { SourceConfig } from '../sources/types'
import { checkKey, copyAgain, copyInfo, createCopy, type CopyColumn } from '../sources/table-copy'

const DATA_SOURCE = 'Data Source'

function assertDataSource(table: string): void {
  if (table !== DATA_SOURCE) throw new AppError('NotFoundError', `No such action for ${table}`)
}

function tokenArg(args: Record<string, unknown>): string {
  const token = typeof args.token === 'string' ? args.token.trim() : ''
  if (!token) throw new AppError('ValidationError', 'Paste a MotherDuck token', { token: 'Paste a MotherDuck token' })
  return token
}

async function storeToken(name: string, token: string): Promise<void> {
  await sql`insert into featherbase.data_source_secret (data_source, token_ciphertext)
            values (${name}, ${encryptSecret(token)})
            on conflict (data_source) do update set token_ciphertext = excluded.token_ciphertext, updated_at = now()`
  await sql`update featherbase.data_source set token_last_four = ${lastFour(token)} where row_id = ${name}`
}

async function warehouseSource(name: string): Promise<SourceConfig> {
  const cfg = await getSource(name)
  if (cfg.engine !== 'motherduck') throw new AppError('ValidationError', `Data source ${name} is not a MotherDuck source connected by a token`)
  return cfg
}

/** The chosen database `database`, or a refusal: a source reads only its chosen databases. */
function chosen(cfg: SourceConfig, database: unknown): WarehouseDatabase {
  const db = cfg.databases.find((d) => d.name === database)
  if (!db) throw new AppError('PermissionError', `Data source ${cfg.name} does not read the database ${String(database)}`)
  return db
}

interface TableListing { listed_at: string; schemas: { schema: string; tables: { name: string; rows: number; columns: number }[] }[] }

async function readTableList(cfg: SourceConfig, database: string): Promise<TableListing> {
  const rows = await run(cfg,
    `select schema_name, table_name, estimated_size, column_count from duckdb_tables()
     where database_name = ? order by schema_name, table_name`, [database])
  const schemas = new Map<string, TableListing['schemas'][number]>()
  for (const r of rows) {
    const schema = String(r.schema_name)
    if (!schemas.has(schema)) schemas.set(schema, { schema, tables: [] })
    schemas.get(schema)!.tables.push({ name: String(r.table_name), rows: Number(r.estimated_size), columns: Number(r.column_count) })
  }
  const [saved] = await sql`
    insert into featherbase.data_source_catalog (data_source, database, tables)
    values (${cfg.name}, ${database}, ${sql.json([...schemas.values()])})
    on conflict (data_source, database) do update set tables = excluded.tables, listed_at = now()
    returning listed_at`
  return { listed_at: (saved.listed_at as Date).toISOString(), schemas: [...schemas.values()] }
}

registerCollectionAction('motherduck_test', {
  // It writes nothing, but it carries a token, so it is a POST: a GET would put
  // the token in URLs and access logs.
  effect: 'write',
  description: 'Test a pasted MotherDuck token: who it signs in as, whether it can write, and the databases it can read.',
  handler: async ({ table, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.row_id)
    const report = await inspectToken(tokenArg(args))
    // The page needs names and owners only; addresses are kept on the source.
    return { user: report.user, can_write: report.can_write, databases: report.databases.map(({ name, owner }) => ({ name, owner })) }
  },
})

registerCollectionAction('motherduck_connect', {
  effect: 'write',
  description: 'Save a MotherDuck source from a pasted token and the databases chosen for it.',
  handler: async ({ table, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.row_id)
    const token = tokenArg(args)
    const names = Array.isArray(args.databases) ? args.databases.map(String) : []
    if (!names.length) throw new AppError('ValidationError', 'Choose at least one database', { databases: 'Choose at least one database' })
    // Addresses come from MotherDuck's own listing, never from the request.
    const report = await inspectToken(token)
    const databases = names.map((n) => {
      const matches = report.databases.filter((d) => d.name === n)
      if (!matches.length) throw new AppError('ValidationError', `The token cannot read the database ${n}`, { databases: `The token cannot read ${n}` })
      // Two databases of one name (say, two people share a "gold") would be
      // told apart only by the order MotherDuck lists them in: refuse instead.
      if (matches.length > 1)
        throw new AppError('ValidationError', `Two databases the token can read are called ${n} (from ${matches.map((d) => d.owner).join(' and ')}); Featherbase cannot tell them apart`, { databases: `Two databases are called ${n}` })
      return matches[0]
    })
    const name = String(args.name ?? '')
    await actionTransaction(async () => {
      await saveDoc(DATA_SOURCE, { row_id: name, engine: 'motherduck', access: 'read_only' }, user.row_id, 'insert')
      await sql`update featherbase.data_source set databases = ${sql.json(databases)} where row_id = ${name}`
      await storeToken(name, token)
      await sql`update featherbase.data_source set conn_status = 'ok', last_checked_at = now(), last_error = null where row_id = ${name}`
    })
    invalidateSources(name)
    return { name }
  },
})

registerRowAction('replace_token', {
  effect: 'write',
  description: 'Replace a MotherDuck source’s token; the new token is tested first.',
  handler: async ({ table, name, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.row_id)
    const cfg = await warehouseSource(name)
    const token = tokenArg(args)
    const report = await inspectToken(token)
    // The same database, not just one of the same name: another account's
    // "gold" must not quietly stand in for this source's.
    const missing = cfg.databases.filter((d) => !report.databases.some((r) => r.name === d.name && r.address === d.address)).map((d) => d.name)
    if (missing.length) throw new AppError('ValidationError', `The new token cannot read ${missing.join(', ')}`, { token: `The new token cannot read ${missing.join(', ')}` })
    await actionTransaction(() => storeToken(name, token))
    invalidateSources(name)
    return { token_last_four: lastFour(token), can_write: report.can_write }
  },
})

registerRowAction('tables', {
  effect: 'read',
  description: 'List a MotherDuck source database’s schemas and tables, kept until refreshed.',
  handler: async ({ table, name, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.row_id)
    const cfg = await warehouseSource(name)
    const db = chosen(cfg, args.database)
    const [kept] = await sql`select tables, listed_at from featherbase.data_source_catalog where data_source = ${name} and database = ${db.name}`
    if (kept) return { listed_at: (kept.listed_at as Date).toISOString(), schemas: kept.tables }
    return readTableList(cfg, db.name)
  },
})

registerRowAction('refresh_tables', {
  effect: 'write',
  description: 'Read a MotherDuck source database’s table list again.',
  handler: async ({ table, name, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.row_id)
    const cfg = await warehouseSource(name)
    const db = chosen(cfg, args.database)
    // A fresh session sees tables added since the last one opened.
    invalidateSources(name)
    return readTableList(await warehouseSource(name), db.name)
  },
})

registerRowAction('preview', {
  effect: 'read',
  description: 'Preview one table of a MotherDuck source: row and column counts, first rows, column names.',
  handler: async ({ table, name, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.row_id)
    const cfg = await warehouseSource(name)
    const db = chosen(cfg, args.database)
    const schema = String(args.schema ?? '')
    const tableName = String(args.table ?? '')
    const columns = await run(cfg,
      `select column_name, data_type from duckdb_columns()
       where database_name = ? and schema_name = ? and table_name = ? order by column_index`, [db.name, schema, tableName])
    if (!columns.length) throw new AppError('NotFoundError', `No table ${schema}.${tableName} in ${db.name}`)
    const relation = [db.name, schema, tableName].map(quoteIdentifier).join('.')
    const [count] = await run(cfg, `select count(*) as n from ${relation}`, [])
    const firstRows = await run(cfg, `select * from ${relation} limit 5`, [])
    return {
      rows: Number(count.n),
      columns: columns.map((c) => ({ name: String(c.column_name), type: String(c.data_type) })),
      first_rows: firstRows,
    }
  },
})

// #772 part 2: copy a warehouse table into Featherbase, and copy it again.
//   GET  /api/table/Data Source/<name>:copy_check_key?database=&schema=&table=&column=
//   POST /api/table/Data Source/<name>:copy_create { database, schema, table, name, key, columns }
//   GET  /api/table/<copied table>:copy_info
//   POST /api/table/<copied table>:copy_again
registerRowAction('copy_check_key', {
  effect: 'read',
  description: 'Say whether a warehouse column can match rows: every value different, none empty.',
  handler: async ({ table, name, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.row_id)
    const db = chosen(await warehouseSource(name), args.database)
    return checkKey(name, db.name, String(args.schema ?? ''), String(args.table ?? ''), String(args.column ?? ''))
  },
})

registerRowAction('copy_create', {
  effect: 'write',
  description: 'Create a Featherbase table from a warehouse table and copy its rows in.',
  handler: async ({ table, name, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.row_id)
    const db = chosen(await warehouseSource(name), args.database)
    const columns = (Array.isArray(args.columns) ? args.columns : []) as CopyColumn[]
    return createCopy(user, {
      source: name, database: db.name, schema: String(args.schema ?? ''), table: String(args.table ?? ''),
      name: String(args.name ?? '').trim(), key: String(args.key ?? ''), columns,
    })
  },
})

registerCollectionAction('copy_info', {
  effect: 'read',
  description: 'Where a copied table was copied from, and when.',
  handler: async ({ table, user }) => {
    await assertSystemManager(user.row_id)
    const copy = await copyInfo(table)
    if (!copy) throw new AppError('NotFoundError', `${table} was not copied from a data source`)
    return copy
  },
})

registerCollectionAction('copy_again', {
  effect: 'write',
  description: 'Read the source table again and import it as one run.',
  handler: async ({ table, user }) => {
    await assertSystemManager(user.row_id)
    return copyAgain(user, table)
  },
})
