// EML-006 / UI-017: assignments. Assigning a document to a user creates a
// ToDo (their task list) and notifies them.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'ToDo'`
  if (exists) return
  await createTable({
    name: 'ToDo',
    module: 'Core',
    columns: [
      { column_name: 'allocated_to', column_type: 'Reference', reference_table: 'User', reqd: true, in_list_view: true },
      { column_name: 'reference_doctype', column_type: 'Reference', reference_table: 'Table', in_list_view: true },
      { column_name: 'reference_name', column_type: 'Data', in_list_view: true },
      { column_name: 'description', column_type: 'Text' },
      { column_name: 'status', column_type: 'Choice', choices: 'Open\nClosed', default_value: 'Open', in_list_view: true },
      { column_name: 'priority', column_type: 'Choice', choices: 'Low\nMedium\nHigh', default_value: 'Medium' },
    ],
  })
}
