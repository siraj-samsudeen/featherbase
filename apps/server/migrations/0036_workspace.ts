// UI-027: Workspaces — configurable module home pages with shortcuts (links to
// Table lists, reports, dashboards) stored as JSON.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Workspace'`
  if (exists) return
  await createTable({
    name: 'Workspace',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'label', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'icon', column_type: 'Data' },
      // [{ label, type: 'doctype'|'report'|'dashboard'|'url', link_to }]
      { column_name: 'shortcuts', column_type: 'JSON' },
    ],
  })
}
