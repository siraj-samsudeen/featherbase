// META-014: core DocTypes + bootstrap users/roles, installed through the
// engine itself so tables, validation, and children behave like any model.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'
import { saveDoc } from '../src/document'

async function ensureTable(def: Parameters<typeof createTable>[0] & { name: string }) {
  const [exists] = await sql`select 1 from table_def where name = ${def.name}`
  if (!exists) await createTable(def)
}

async function ensureRow(table: string, doc: Record<string, unknown>) {
  const physical = table.toLowerCase().replace(/\s+/g, '_')
  const [exists] = await sql`
    select 1 from ${sql(physical)} where row_id = ${String(doc.row_id)}`
  if (!exists) await saveDoc(table, doc)
}

export async function up() {
  await ensureTable({
    name: 'Role',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [{ column_name: 'disabled', column_type: 'Check', default_value: '0' }],
  })

  await ensureTable({
    name: 'Has Role',
    module: 'Core',
    kind: 'sub_table',
    columns: [{ column_name: 'role', column_type: 'Reference', reference_table: 'Role', reqd: true }],
  })

  await ensureTable({
    name: 'User',
    module: 'Core',
    id_pattern: 'prompt',
    title_column: 'full_name',
    columns: [
      { column_name: 'email', column_type: 'Data', reqd: true, unique: true, in_list_view: true },
      { column_name: 'full_name', column_type: 'Data', in_list_view: true },
      { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
      { column_name: 'password_hash', column_type: 'Data', hidden: true, read_only: true },
      { column_name: 'language', column_type: 'Data' },
      { column_name: 'roles', column_type: 'Sub-table', row_table: 'Has Role' },
    ],
  })

  await ensureTable({
    name: 'Permission',
    module: 'Core',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'role', column_type: 'Reference', reference_table: 'Role', reqd: true, in_list_view: true },
      { column_name: 'tier', column_type: 'Choice', choices: 'basic\nrestricted', default_value: 'basic' },
      { column_name: 'own_rows_only', column_type: 'Check', default_value: '0' },
      { column_name: 'can_read', column_type: 'Check', default_value: '0' },
      { column_name: 'can_write', column_type: 'Check', default_value: '0' },
      { column_name: 'can_create', column_type: 'Check', default_value: '0' },
      { column_name: 'can_delete', column_type: 'Check', default_value: '0' },
      { column_name: 'can_submit', column_type: 'Check', default_value: '0' },
      { column_name: 'can_cancel', column_type: 'Check', default_value: '0' },
      { column_name: 'can_amend', column_type: 'Check', default_value: '0' },
    ],
  })

  await ensureTable({
    name: 'Comment',
    module: 'Core',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', reqd: true },
      { column_name: 'ref_name', column_type: 'Data', reqd: true },
      { column_name: 'content', column_type: 'Text', reqd: true },
    ],
  })

  await ensureTable({
    name: 'Version',
    module: 'Core',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', reqd: true },
      { column_name: 'ref_name', column_type: 'Data', reqd: true },
      { column_name: 'data', column_type: 'JSON' },
    ],
  })

  await ensureTable({
    name: 'File',
    module: 'Core',
    columns: [
      { column_name: 'file_name', column_type: 'Data', reqd: true },
      { column_name: 'file_url', column_type: 'Data' },
      { column_name: 'mime_type', column_type: 'Data' },
      { column_name: 'file_size', column_type: 'Int' },
      { column_name: 'is_private', column_type: 'Check', default_value: '1' },
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'ref_name', column_type: 'Data' },
    ],
  })

  for (const role of ['System Manager', 'All', 'Guest'])
    await ensureRow('Role', { row_id: role })

  await ensureRow('User', {
    row_id: 'Administrator',
    email: 'admin@example.com',
    full_name: 'Administrator',
    enabled: true,
    roles: [{ role: 'System Manager' }],
  })
  await ensureRow('User', {
    row_id: 'Guest',
    email: 'guest@example.com',
    full_name: 'Guest',
    enabled: true,
  })
}
