// EML-007: Auto Email Report — a saved Report scheduled to be emailed to a
// list of recipients on a cadence. The scheduler ticks daily and delivers the
// ones that are due; each delivery attaches the rendered report (CSV/HTML).
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Auto Email Report'`
  if (exists) return
  await createTable({
    name: 'Auto Email Report',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'report', column_type: 'Reference', reference_table: 'Report', reqd: true, in_list_view: true },
      { column_name: 'recipients', column_type: 'Text', reqd: true },
      { column_name: 'file_format', column_type: 'Choice', choices: 'CSV\nHTML', default_value: 'CSV', in_list_view: true },
      { column_name: 'frequency', column_type: 'Choice', choices: 'Daily\nWeekly\nMonthly', default_value: 'Daily', in_list_view: true },
      { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
      { column_name: 'last_sent', column_type: 'Datetime', read_only: true },
    ],
  })
}
