// #919 (piece B of #683): a Permission row may cover only the rows of the
// stores its holder administers ('reach'), and an app's store administrators
// may give its narrower roles (Role Assignment). Role Assignment is written
// only by the platform's checked give and take-back, never by generic CRUD,
// so no grant and no Administrator can give a role from the side. Rows are
// never deleted: a taken-back role stays on record.
import { sql } from '../src/db'
import { getMeta, invalidateMeta } from '../src/meta'
import { createTable, updateTable } from '../src/table-engine'

export async function up() {
  const permission = await getMeta('Permission')
  await updateTable('Permission', {
    ...permission,
    columns: permission.columns.map((column) => column.column_name !== 'scope_mode' ? column : {
      ...column,
      choices: 'all\ncreator\nreach',
      choice_labels: { all: 'All rows', creator: 'Rows the person created', reach: "Rows of the stores the person administers" },
    }),
  })
  await createTable({ name: 'Role Assignment', system: true, columns: [
    { column_name: 'app', column_type: 'Data', reqd: true, in_list_view: true },
    { column_name: 'person', column_type: 'Reference', reference_table: 'Person', reqd: true, in_list_view: true },
    { column_name: 'role', column_type: 'Reference', reference_table: 'Role', reqd: true, in_list_view: true },
    { column_name: 'stores', column_type: 'JSON', reqd: true },
    { column_name: 'starts_on', column_type: 'Date' },
    { column_name: 'ends_on', column_type: 'Date' },
    { column_name: 'given_by', column_type: 'Reference', reference_table: 'Person', reqd: true },
    { column_name: 'given_through', column_type: 'Data', reqd: true },
    { column_name: 'revoked_at', column_type: 'Datetime' },
    { column_name: 'revoked_by', column_type: 'Data' },
  ] })
  await sql`update table_def set system_written = true where name = 'Role Assignment'`
  invalidateMeta('Role Assignment')
  await sql`alter table featherbase.role_assignment
    add constraint role_assignment_period check (starts_on is null or ends_on is null or starts_on < ends_on),
    add constraint role_assignment_stores check (jsonb_typeof(stores) = 'array' and jsonb_array_length(stores) > 0),
    add constraint role_assignment_not_own check (person <> given_by)`
  await sql`create index role_assignment_holder on featherbase.role_assignment (app, person)`
}
