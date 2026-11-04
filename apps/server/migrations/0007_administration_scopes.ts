// #462; reserved on #566. Assignments are platform-written: generic CRUD,
// including Administrator HTTP, cannot bypass checked delegation operations.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'
import { invalidateMeta } from '../src/meta'

export async function up() {
  await createTable({ name: 'Scope', system: true, columns: [
    { column_name: 'app', column_type: 'Data', reqd: true },
    { column_name: 'mode', column_type: 'Choice', choices: 'all\ncreator\nself\nnamed\ndirect_reports\nsubtree', reqd: true },
    { column_name: 'tuples', column_type: 'JSON' },
  ] })
  await createTable({ name: 'Role Assignment', system: true, columns: [
    { column_name: 'app', column_type: 'Data', reqd: true },
    { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
    { column_name: 'service_account', column_type: 'Reference', reference_table: 'Service Account' },
    { column_name: 'role', column_type: 'Reference', reference_table: 'Role', reqd: true },
    { column_name: 'scope', column_type: 'Reference', reference_table: 'Scope', reqd: true },
    { column_name: 'starts_on', column_type: 'Date' },
    { column_name: 'ends_on', column_type: 'Date' },
  ] })
  await sql`update table_def set system_written = true where name in ('Scope', 'Role Assignment')`
  invalidateMeta('Scope')
  invalidateMeta('Role Assignment')
  await sql`alter table featherbase.role_assignment
    add constraint role_assignment_principal check ((person is not null) <> (service_account is not null)),
    add constraint role_assignment_period check (starts_on is null or ends_on is null or starts_on < ends_on),
    add constraint role_assignment_scope foreign key (scope) references featherbase.scope(row_id),
    add constraint role_assignment_role foreign key (role) references featherbase.role(row_id),
    add constraint role_assignment_person foreign key (person) references featherbase.person(row_id),
    add constraint role_assignment_service foreign key (service_account) references featherbase.service_account(row_id)`
  await sql`create index role_assignment_person_role on featherbase.role_assignment (person, role)`
  await sql`create index role_assignment_service_role on featherbase.role_assignment (service_account, role)`
}
