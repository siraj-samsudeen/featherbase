// RPT-002: a saved report is a Report document — DocType + the view
// configuration (columns, group_by, filters) as JSON.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Report'`
  if (exists) return
  await createDocType({
    name: 'Report',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'ref_doctype', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'config', fieldtype: 'JSON' },
    ],
  })
}
