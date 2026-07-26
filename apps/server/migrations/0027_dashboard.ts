// UI-026: Dashboards — a saved layout of number cards and charts, each driven
// by a DocType + optional filters (and a group-by for charts). The layout is a
// JSON config; cards/charts are computed on demand from live data.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Dashboard'`
  if (exists) return
  await createTable({
    name: 'Dashboard',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'label', column_type: 'Data', in_list_view: true },
      // { cards: [{label, doctype, filters}], charts: [{label, doctype, group_by, filters}] }
      { column_name: 'config', column_type: 'JSON' },
    ],
  })
}
