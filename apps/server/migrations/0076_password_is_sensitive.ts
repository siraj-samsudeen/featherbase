// `password` joins SENSITIVE_COLUMNS (sensitive-columns.ts): the real VMS
// source (Django) exposed every user's password hash through a reflected
// `password` column. Reflection now skips the name; this drops the
// column_defs it already created. Bound tables only — their columns are
// metadata with no DDL behind them (BV1), so deleting the row is the whole
// operation. No native table defines a `password` column (checked at
// authoring time), and the native path never could serialize one anyway.
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

export async function up() {
  const rows = await sql<{ parent: string }[]>`
    delete from column_def
    where column_name = 'password'
      and parent in (select name from table_def where data_source is not null)
    returning parent`
  for (const r of rows) invalidateMeta(r.parent)
}
