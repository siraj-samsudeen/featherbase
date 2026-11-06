// #772, #969: a MotherDuck source, read with the instance's one token (ADR 0020).
//   GET  /api/table/Data Source:motherduck_databases
//   POST /api/table/Data Source:motherduck_connect  { name, databases }
//   GET  /api/table/Data Source/<name>:tables?database=
//   POST /api/table/Data Source/<name>:refresh_tables { database }
//   GET  /api/table/Data Source/<name>:preview?database=&schema=&table=
// Every action is System Manager only. The token is never returned or logged.
import { AppError } from '../errors'
import { registerCollectionAction, registerRowAction } from '../actions'
import { actionTransaction } from '../action-transaction'
import { sql } from '../db'
import { saveDoc } from '../document'
import { assertSystemManager } from '../permissions'
import { assertAllowed, getSource, invalidateSources } from '../sources/registry'
import { run, quoteIdentifier } from '../sources/duckdb-driver'
import { inspectWarehouse, pickDatabase, type ChosenDatabase } from '../sources/motherduck'
import type { SourceConfig } from '../sources/types'
import { checkKey, copyAgain, copyInfo, createCopy, type CopyColumn } from '../sources/table-copy'
import { syncAfterCopy } from '../master-sync'

const DATA_SOURCE = 'Data Source'

function assertDataSource(table: string): void {
  if (table !== DATA_SOURCE) throw new AppError('NotFoundError', `No such action for ${table}`)
}

async function warehouseSource(name: string): Promise<SourceConfig> {
  const cfg = await getSource(name)
  if (cfg.engine !== 'motherduck') throw new AppError('ValidationError', `Data source ${name} is not a MotherDuck source`)
  return cfg
}

/** The chosen database `database`, or a refusal: a source reads only its chosen databases. */
function chosen(cfg: SourceConfig, database: unknown): ChosenDatabase {
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

registerCollectionAction('motherduck_databases', {
  effect: 'read',
  description: 'Who the instance\'s MotherDuck token signs in as, and the databases it can read.',
  handler: async ({ table, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.row_id)
    const report = await inspectWarehouse()
    // The page needs names and owners only.
    return { user: report.user, databases: report.databases.map(({ name, owner }) => ({ name, owner })) }
  },
})

registerCollectionAction('motherduck_connect', {
  effect: 'write',
  description: 'Save a MotherDuck source that reads the chosen databases.',
  handler: async ({ table, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.row_id)
    const names = Array.isArray(args.databases) ? args.databases.map(String) : []
    if (!names.length) throw new AppError('ValidationError', 'Choose at least one database', { databases: 'Choose at least one database' })
    const report = await inspectWarehouse()
    const databases = names.map((n) => {
      const { name, owner } = pickDatabase(report.databases, n)
      return { name, owner }
    })
    const name = String(args.name ?? '')
    await actionTransaction(async () => {
      await saveDoc(DATA_SOURCE, { row_id: name, engine: 'motherduck', access: 'read_only', databases }, user.row_id, 'insert')
      await sql`update featherbase.data_source set conn_status = 'ok', last_checked_at = now(), last_error = null where row_id = ${name}`
    })
    invalidateSources(name)
    return { name }
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
    assertAllowed(cfg, `${db.name}.${schema}`, tableName)
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
    const result = await copyAgain(user, table)
    // #927: a copy with a master sync rule brings its master Table in step.
    const masterSync = await syncAfterCopy(user, table)
    return masterSync ? { ...result, master_sync: masterSync } : result
  },
})
