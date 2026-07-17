// META-014: core DocTypes + bootstrap users/roles, installed through the
// engine itself so tables, validation, and children behave like any model.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'
import { saveDoc } from '../src/document'

async function ensureDocType(def: Parameters<typeof createDocType>[0] & { name: string }) {
  const [exists] = await sql`select 1 from tab_doctype where name = ${def.name}`
  if (!exists) await createDocType(def)
}

async function ensureDoc(doctype: string, doc: Record<string, unknown>) {
  const table = 'tab_' + doctype.toLowerCase().replace(/\s+/g, '_')
  const [exists] = await sql`
    select 1 from ${sql(table)} where name = ${String(doc.name)}`
  if (!exists) await saveDoc(doctype, doc)
}

export async function up() {
  await ensureDocType({
    name: 'Role',
    module: 'Core',
    autoname: 'prompt',
    fields: [{ fieldname: 'disabled', fieldtype: 'Check', default_value: '0' }],
  })

  await ensureDocType({
    name: 'Has Role',
    module: 'Core',
    istable: true,
    fields: [{ fieldname: 'role', fieldtype: 'Link', options: 'Role', reqd: true }],
  })

  await ensureDocType({
    name: 'User',
    module: 'Core',
    autoname: 'prompt',
    title_field: 'full_name',
    fields: [
      { fieldname: 'email', fieldtype: 'Data', reqd: true, unique: true, in_list_view: true },
      { fieldname: 'full_name', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'enabled', fieldtype: 'Check', default_value: '1', in_list_view: true },
      { fieldname: 'password_hash', fieldtype: 'Data', hidden: true, read_only: true },
      { fieldname: 'language', fieldtype: 'Data' },
      { fieldname: 'roles', fieldtype: 'Table', options: 'Has Role' },
    ],
  })

  await ensureDocType({
    name: 'DocPerm',
    module: 'Core',
    fields: [
      { fieldname: 'ref_doctype', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'role', fieldtype: 'Link', options: 'Role', reqd: true, in_list_view: true },
      { fieldname: 'permlevel', fieldtype: 'Int', default_value: '0' },
      { fieldname: 'if_owner', fieldtype: 'Check', default_value: '0' },
      { fieldname: 'can_read', fieldtype: 'Check', default_value: '0' },
      { fieldname: 'can_write', fieldtype: 'Check', default_value: '0' },
      { fieldname: 'can_create', fieldtype: 'Check', default_value: '0' },
      { fieldname: 'can_delete', fieldtype: 'Check', default_value: '0' },
      { fieldname: 'can_submit', fieldtype: 'Check', default_value: '0' },
      { fieldname: 'can_cancel', fieldtype: 'Check', default_value: '0' },
      { fieldname: 'can_amend', fieldtype: 'Check', default_value: '0' },
    ],
  })

  await ensureDocType({
    name: 'Comment',
    module: 'Core',
    fields: [
      { fieldname: 'ref_doctype', fieldtype: 'Link', options: 'DocType', reqd: true },
      { fieldname: 'ref_name', fieldtype: 'Data', reqd: true },
      { fieldname: 'content', fieldtype: 'Text', reqd: true },
    ],
  })

  await ensureDocType({
    name: 'Version',
    module: 'Core',
    fields: [
      { fieldname: 'ref_doctype', fieldtype: 'Link', options: 'DocType', reqd: true },
      { fieldname: 'ref_name', fieldtype: 'Data', reqd: true },
      { fieldname: 'data', fieldtype: 'JSON' },
    ],
  })

  await ensureDocType({
    name: 'File',
    module: 'Core',
    fields: [
      { fieldname: 'file_name', fieldtype: 'Data', reqd: true },
      { fieldname: 'file_url', fieldtype: 'Data' },
      { fieldname: 'mime_type', fieldtype: 'Data' },
      { fieldname: 'file_size', fieldtype: 'Int' },
      { fieldname: 'is_private', fieldtype: 'Check', default_value: '1' },
      { fieldname: 'ref_doctype', fieldtype: 'Link', options: 'DocType' },
      { fieldname: 'ref_name', fieldtype: 'Data' },
    ],
  })

  for (const role of ['System Manager', 'All', 'Guest'])
    await ensureDoc('Role', { name: role })

  await ensureDoc('User', {
    name: 'Administrator',
    email: 'admin@example.com',
    full_name: 'Administrator',
    enabled: true,
    roles: [{ role: 'System Manager' }],
  })
  await ensureDoc('User', {
    name: 'Guest',
    email: 'guest@example.com',
    full_name: 'Guest',
    enabled: true,
  })
}
