// UI-027: Workspaces — configurable module home pages with shortcuts (links to
// DocType lists, reports, dashboards) stored as JSON.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Workspace'`
  if (exists) return
  await createDocType({
    name: 'Workspace',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'label', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'icon', fieldtype: 'Data' },
      // [{ label, type: 'doctype'|'report'|'dashboard'|'url', link_to }]
      { fieldname: 'shortcuts', fieldtype: 'JSON' },
    ],
  })
}
