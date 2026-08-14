// DOC-008: backfill amended_from on submittable DocTypes created before the
// engine auto-added it.
import { sql } from '../src/db'
import { tableName } from '../src/table-engine'
import { invalidateMeta } from '../src/meta'

export async function up() {
  const tables = await sql`
    select name from table_def where is_submittable = true and kind != 'settings'`
  for (const dt of tables) {
    const name = dt.name as string
    const [column] = await sql`
      select 1 from column_def where parent = ${name} and column_name = 'amended_from'`
    if (column) continue
    const [{ max }] = await sql`
      select coalesce(max(position), 0)::int as max from column_def where parent = ${name}`
    await sql`insert into column_def ${sql({
      parent: name,
      position: (max as number) + 1,
      column_name: 'amended_from',
      label: 'Amended From',
      column_type: 'Reference',
      reference_table: name,
      hidden: true,
    })}`
    await sql.unsafe(
      `alter table "${tableName(name)}" add column if not exists "amended_from" varchar(140)`,
    )
    invalidateMeta(name)
  }
}
