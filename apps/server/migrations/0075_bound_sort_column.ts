// #176: bound tables without a modified mapping carry the DB-default
// sort_column 'updated_at', a column they don't have — every list load that
// sends the default order explicitly is refused. Repair existing rows to
// sort by the pk alias; reflect.ts now sets this at creation.
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

export async function up() {
  const rows = await sql<{ name: string }[]>`
    update table_def set sort_column = 'name'
    where data_source is not null
      and external_modified is null
      and sort_column = 'updated_at'
    returning name`
  for (const r of rows) invalidateMeta(r.name)
}
