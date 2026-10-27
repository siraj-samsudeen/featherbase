// #620 (feather-dash-installed-app, design E2 and D4): two platform security
// Tables an installed app relies on.
//
// - App Setting: one row per app setting an instance fills in, keyed
//   `<app>.<setting>`. The app declares the names it reads; the instance sets
//   the values through its settings file. Secrets are never stored here: they
//   stay deployment variables.
// - App Role Binding: which of the instance's roles (jobs, in time) carry
//   each of an app's roles. People never hold an app's roles by hand; a System
//   Manager edits these rows in Admin, seeded once from the app's suggestions.
//
// Both are new; no existing data is rewritten.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

export async function up() {
  const [setting] = await sql`select 1 from table_def where name = 'App Setting'`
  if (!setting) {
    await createTable({
      name: 'App Setting',
      module: 'Core',
      system: true,
      // `<app>.<setting>`: the app and setting columns are read from it.
      id_pattern: 'prompt',
      title_column: 'setting',
      columns: [
        { column_name: 'app', label: 'App', column_type: 'Data', read_only: true, in_list_view: true },
        { column_name: 'setting', label: 'Setting', column_type: 'Data', read_only: true, in_list_view: true },
        { column_name: 'value', label: 'Value', column_type: 'Text', in_list_view: true },
      ],
    })
  }
  const [binding] = await sql`select 1 from table_def where name = 'App Role Binding'`
  if (!binding) {
    await createTable({
      name: 'App Role Binding',
      module: 'Core',
      system: true,
      columns: [
        { column_name: 'app', label: 'App', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'app_role', label: 'App role', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'bound_role', label: 'Held through role', column_type: 'Reference', reference_table: 'Role', reqd: true, in_list_view: true },
      ],
    })
  }
}
