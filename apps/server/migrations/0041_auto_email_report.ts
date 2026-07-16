// EML-007: Auto Email Report — a saved Report scheduled to be emailed to a
// list of recipients on a cadence. The scheduler ticks daily and delivers the
// ones that are due; each delivery attaches the rendered report (CSV/HTML).
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Auto Email Report'`
  if (exists) return
  await createDocType({
    name: 'Auto Email Report',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'report', fieldtype: 'Link', options: 'Report', reqd: true, in_list_view: true },
      { fieldname: 'recipients', fieldtype: 'Text', reqd: true },
      { fieldname: 'file_format', fieldtype: 'Select', options: 'CSV\nHTML', default_value: 'CSV', in_list_view: true },
      { fieldname: 'frequency', fieldtype: 'Select', options: 'Daily\nWeekly\nMonthly', default_value: 'Daily', in_list_view: true },
      { fieldname: 'enabled', fieldtype: 'Check', default_value: '1', in_list_view: true },
      { fieldname: 'last_sent', fieldtype: 'Datetime', read_only: true },
    ],
  })
}
