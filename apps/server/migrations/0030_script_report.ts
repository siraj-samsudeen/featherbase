// RPT-005: a Report of report_type 'Script Report' names a registered
// server-side report function in `report_script`. Adds the field + column and
// the new Select option. Idempotent.
import { sql } from '../src/db'
import { columnType } from '../src/doctype-engine'

export async function up() {
  const [rt] = await sql`select 1 from tab_doctype where name = 'Report'`
  if (!rt) return

  // Allow 'Script Report' in the report_type Select options.
  await sql`
    update tab_docfield set options = 'Report Builder\nQuery Report\nScript Report'
    where parent = 'Report' and fieldname = 'report_type'`

  const type = columnType('Data')
  if (type) await sql.unsafe(`alter table tab_report add column if not exists "report_script" ${type}`)
  const [f] = await sql`select 1 from tab_docfield where parent = 'Report' and fieldname = 'report_script'`
  if (f) return
  const [{ maxidx }] = await sql`select coalesce(max(idx), 0)::int as maxidx from tab_docfield where parent = 'Report'`
  await sql`insert into tab_docfield ${sql({
    parent: 'Report',
    idx: (maxidx as number) + 1,
    fieldname: 'report_script',
    label: 'Report Script',
    fieldtype: 'Data',
    options: null,
    reqd: false,
    unique: false,
    default_value: null,
    read_only: false,
    hidden: false,
    in_list_view: false,
    permlevel: 0,
  })}`
}
