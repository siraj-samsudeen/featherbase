// #1022: the submit lifecycle moves from `status` to `submission_status` on
// every stored Table, so a business column can be called `status`. A rename
// rewrites no rows and keeps the default and the not-null. New Tables get the
// new name from createTable (0150 already makes one), so each Table is checked
// on its own.
//
// `submission_status` was free before this change, so a builder's column
// holding it would be silently adopted as lifecycle state, which locks rows.
// The same goes for a `status` that is not the platform's. The migration
// refuses instead, naming each one: rename it first, then migrate.
import { sql } from '../src/db'
import { quoteRelation, storedRelation } from '../src/table-engine'

const LIFECYCLE = ['draft', 'submitted', 'cancelled']

export async function up() {
  const clashes: string[] = []
  const targets: string[] = []
  const tables = await sql<{ name: string; data_source: string | null }[]>`
    select name, data_source from table_def order by name`
  const declared = await sql<{ parent: string; column_name: string }[]>`
    select parent, column_name from column_def where column_name in ('status', 'submission_status')`
  const isDeclared = (table: string, column: string) =>
    declared.some((c) => c.parent === table && c.column_name === column)
  for (const table of tables) {
    // A connected Table's rows live in the source; it has no column of ours.
    if (table.data_source) continue
    const relation = await storedRelation(table.name)
    const [present] = await sql`select to_regclass(${quoteRelation(relation)}) as oid`
    if (!present?.oid) continue
    const [schema, name] = relation.split('.')
    const columns = await sql<{ column_name: string; data_type: string; column_default: string | null }[]>`
      select column_name, data_type, column_default from information_schema.columns
      where table_schema = ${schema} and table_name = ${name} and column_name in ('status', 'submission_status')`
    const status = columns.find((c) => c.column_name === 'status')
    const lifecycle = columns.find((c) => c.column_name === 'submission_status')
    if (isDeclared(table.name, 'submission_status')) clashes.push(`${table.name}.submission_status`)
    else if (lifecycle) {
      // Already moved (a rerun, or made by this version). A `status` beside it
      // must be a declared business column.
      if (status && !isDeclared(table.name, 'status')) clashes.push(`${table.name}.status`)
    } else if (status) {
      const platform = status.data_type === 'text' && status.column_default?.startsWith(`'draft'`)
      const [stray] = platform
        ? await sql.unsafe(`select 1 from ${quoteRelation(relation)} where status <> all($1::text[]) limit 1`, [LIFECYCLE])
        : [true]
      if (stray || isDeclared(table.name, 'status')) clashes.push(`${table.name}.status`)
      else targets.push(relation)
    }
  }
  if (clashes.length)
    throw new Error(`The submit lifecycle needs its column called submission_status, and these columns are not the platform's own: ${clashes.join(', ')}. Rename those columns, then migrate again. Nothing was changed.`)
  for (const relation of targets)
    await sql.unsafe(`alter table ${quoteRelation(relation)} rename column status to submission_status`)
}
