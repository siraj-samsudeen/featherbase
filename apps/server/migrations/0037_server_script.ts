// CUST-004: Server Scripts — sandboxed user scripts that run on document
// lifecycle events (and, optionally, as callable API methods).
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Server Script'`
  if (exists) return
  await createTable({
    name: 'Server Script',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'script_type', column_type: 'Choice', choices: 'Document Event\nAPI', reqd: true, in_list_view: true },
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', in_list_view: true },
      { column_name: 'event', column_type: 'Choice', choices: 'validate\nbefore_save\nafter_save' },
      { column_name: 'api_method', column_type: 'Data' },
      { column_name: 'script', column_type: 'Long Text', reqd: true },
      { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
    ],
  })
}
