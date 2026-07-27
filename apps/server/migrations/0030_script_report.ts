// RPT-005: a Report of report_type 'Script Report' names a registered
// server-side report function in `report_script`. Adds the field + column and
// the new Choice option. Idempotent.
import { sql } from '../src/db'
import { pgType } from '../src/doctype-engine'

export async function up() {
  const [rt] = await sql`select 1 from table_def where name = 'Report'`
  if (!rt) return

  // Allow 'Script Report' in the report_type Choice options.
  await sql`
    update column_def set choices = 'Report Builder\nQuery Report\nScript Report'
    where parent = 'Report' and column_name = 'report_type'`

  const type = pgType('Data')
  if (type) await sql.unsafe(`alter table report add column if not exists "report_script" ${type}`)
  const [f] = await sql`select 1 from column_def where parent = 'Report' and column_name = 'report_script'`
  if (f) return
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'Report'`
  await sql`insert into column_def ${sql({
    parent: 'Report',
    position: (maxidx as number) + 1,
    column_name: 'report_script',
    label: 'Report Script',
    column_type: 'Data',
    reqd: false,
    unique: false,
    default_value: null,
    read_only: false,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
}
