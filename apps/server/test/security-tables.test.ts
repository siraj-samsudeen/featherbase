// #437: who-can-do-what is System Manager territory. The tables that decide
// access refuse writes from anyone else whatever the Permission rows say, and
// a Person's roles and enabled flag change only for a System Manager.
import { describe, expect } from 'vitest'
import { test, patchDoc } from './pg-test'
import { createUserWithRole, expectApiError, grantRole, makePerson, makeTable, tableRef } from './fixtures'
import { SECURITY_TABLES } from '../src/security-tables'
import { saveDoc, deleteDoc } from '../src/document'
import { evaluateAssignmentRules } from '../src/assignment-rules'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'

const PERSON = tableRef('Person')
const EDITOR = 'Person Editor 437'
const ALL_ACTIONS = { can_read: true, can_write: true, can_create: true, can_delete: true }

async function personEditor(admin: TestClient, createUser: Parameters<typeof createUserWithRole>[1]) {
  return createUserWithRole(admin, createUser, { role: EDITOR, table: 'Person', ...ALL_ACTIONS })
}

async function loaded(admin: TestClient, id: string) {
  return admin.get<Record<string, unknown> & { roles: { row_id: string; role: string }[] }>(PERSON.rowUrl(id))
}

describe("#437: a Person's roles and enabled flag", () => {
  test('ordinary write on Person cannot add a role (PATCH)', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const target = await makePerson({ full_name: 'Target' })
    const doc = await loaded(admin, target)
    await expectApiError(
      patchDoc(editor, PERSON.rowUrl(target), { updated_at: doc.updated_at, roles: [{ role: 'System Manager' }] }),
      { status: 403 },
    )
    expect((await loaded(admin, target)).roles).toEqual([])
  })

  test('ordinary write on Person cannot grant itself a role (save_row)', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const self = await loaded(admin, editor.user!)
    await expectApiError(
      editor.post('/api/save_row', {
        table: 'Person',
        row: { row_id: editor.user, updated_at: self.updated_at, roles: [...self.roles.map((r) => ({ role: r.role })), { role: 'System Manager' }] },
      }),
      { status: 403 },
    )
    expect((await loaded(admin, editor.user!)).roles.map((r) => r.role)).toEqual([EDITOR])
  })

  test('ordinary write on Person cannot remove a role', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const target = await makePerson({ full_name: 'Holder', roles: [{ role: EDITOR }] })
    const doc = await loaded(admin, target)
    await expectApiError(patchDoc(editor, PERSON.rowUrl(target), { updated_at: doc.updated_at, roles: [] }), { status: 403 })
  })

  test('ordinary write on Person cannot create a person holding roles (POST)', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    await expectApiError(editor.post(PERSON.url, { full_name: 'New', roles: [{ role: 'System Manager' }] }), { status: 403 })
  })

  test('ordinary write on Person cannot change enabled, either way', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const target = await makePerson({ full_name: 'Switch' })
    let doc = await loaded(admin, target)
    await expectApiError(patchDoc(editor, PERSON.rowUrl(target), { updated_at: doc.updated_at, enabled: false }), { status: 403 })
    await patchDoc(admin, PERSON.rowUrl(target), { updated_at: doc.updated_at, enabled: false })
    doc = await loaded(admin, target)
    await expectApiError(patchDoc(editor, PERSON.rowUrl(target), { updated_at: doc.updated_at, enabled: true }), { status: 403 })
    expect((await loaded(admin, target)).enabled).toBe(false)
  })

  test('ordinary write on Person cannot change roles or enabled through import upsert', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const target = await makePerson({ full_name: 'Imported', username: 'imported.437' })
    for (const row of [{ username: 'imported.437', enabled: false }, { username: 'imported.437', roles: [{ role: 'System Manager' }] }]) {
      await expectApiError(editor.post(`${PERSON.url}:import`, { key_column: 'username', rows: [row] }), { status: 403, message: expect.stringMatching(/System Manager/) })
    }
    const after = await loaded(admin, target)
    expect(after.enabled).toBe(true)
    expect(after.roles).toEqual([])
  })

  test('a write-share on a Person row does not open roles or enabled', async ({ admin, createUser }) => {
    const sharee = await createUser({ roles: [] })
    const target = await makePerson({ full_name: 'Shared' })
    await admin.post('/api/save_row', { table: 'Share', row: { share_table: 'Person', share_name: target, person: sharee.user, read: true, write: true } })
    const doc = await loaded(admin, target)
    await expectApiError(patchDoc(sharee, PERSON.rowUrl(target), { updated_at: doc.updated_at, enabled: false }), { status: 403 })
  })

  test('unchanged roles and enabled ride along on an ordinary edit', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const target = await makePerson({ full_name: 'Before', roles: [{ role: EDITOR }] })
    const doc = await loaded(admin, target)
    const saved = await patchDoc<Record<string, unknown>>(editor, PERSON.rowUrl(target), {
      updated_at: doc.updated_at, full_name: 'After', enabled: true, roles: doc.roles,
    })
    expect(saved.full_name).toBe('After')
    // A new person with no roles, enabled by default, is an ordinary create.
    const created = await editor.post<{ row_id: string }>(PERSON.url, { full_name: 'Plain', roles: [] })
    expect((await loaded(admin, created.row_id)).enabled).toBe(true)
  })

  // The roles check judges the children as the save applies them: each
  // stored row by its row_id, plus the rows it would insert or delete.
  async function holderOfTwo(admin: TestClient) {
    await grantRole(admin, { role: 'Second Role 437', table: [] })
    const target = await makePerson({ full_name: 'Two Roles', roles: [{ role: 'System Manager' }, { role: 'Second Role 437' }] })
    const doc = await loaded(admin, target)
    const [a, b] = doc.roles
    return { target, doc, a, b }
  }

  test('a payload that repeats a child row_id is refused, even with the same role values', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const { target, doc, a, b } = await holderOfTwo(admin)
    await expectApiError(
      patchDoc(editor, PERSON.rowUrl(target), {
        updated_at: doc.updated_at,
        roles: [{ row_id: b.row_id, role: a.role }, { row_id: b.row_id, role: b.role }],
      }),
      { status: 417 },
    )
    expect((await loaded(admin, target)).roles.map((r) => r.role).sort()).toEqual([a.role, b.role].sort())
  })

  test('a repeated child row_id is refused for a System Manager too', async ({ admin }) => {
    const { target, doc, a } = await holderOfTwo(admin)
    await expectApiError(
      patchDoc(admin, PERSON.rowUrl(target), { updated_at: doc.updated_at, roles: [a, a] }),
      { status: 417 },
    )
  })

  test('dropping a stored child and inserting its role afresh is a change', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const { target, doc, a, b } = await holderOfTwo(admin)
    await expectApiError(
      patchDoc(editor, PERSON.rowUrl(target), { updated_at: doc.updated_at, roles: [a, { role: b.role }] }),
      { status: 403 },
    )
    const after = (await loaded(admin, target)).roles
    expect(after.map((r) => r.row_id).sort()).toEqual([a.row_id, b.row_id].sort())
  })

  test('swapping the roles between two stored row ids is a change', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const { target, doc, a, b } = await holderOfTwo(admin)
    await expectApiError(
      patchDoc(editor, PERSON.rowUrl(target), {
        updated_at: doc.updated_at,
        roles: [{ row_id: a.row_id, role: b.role }, { row_id: b.row_id, role: a.role }],
      }),
      { status: 403 },
    )
  })

  test('the same roles in a different order still ride along', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const { target, doc, a, b } = await holderOfTwo(admin)
    const saved = await patchDoc<Record<string, unknown>>(editor, PERSON.rowUrl(target), {
      updated_at: doc.updated_at, full_name: 'Reordered', roles: [b, a],
    })
    expect(saved.full_name).toBe('Reordered')
    expect((await loaded(admin, target)).roles.map((r) => r.role).sort()).toEqual([a.role, b.role].sort())
  })

  test('a System Manager changes roles and enabled', async ({ admin, createUser }) => {
    const manager = await createUser({ roles: ['System Manager'] })
    await grantRole(admin, { role: EDITOR, table: [] })
    const target = await makePerson({ full_name: 'Managed' })
    const doc = await loaded(admin, target)
    await patchDoc(manager, PERSON.rowUrl(target), { updated_at: doc.updated_at, enabled: false, roles: [{ role: EDITOR }] })
    const after = await loaded(admin, target)
    expect(after.enabled).toBe(false)
    expect(after.roles.map((r) => r.role)).toEqual([EDITOR])
  })
})

// The Sales Target scope tables are ordinary Tables an instance creates; make
// one so the guard has something to refuse.
const SCOPE_TABLES = ['Sales Target Assignment', 'Employee Section Map', 'Section Ownership', 'Store Manager', 'Section Merchandise Map', 'Section Name Alias']

describe('#437: the security tables refuse non-privileged writes, whatever Permission says', () => {
  test('the guarded set names every access-deciding table', () => {
    for (const t of ['Permission', 'Role', 'Has Role', 'Data Scope', 'Share', 'Sign In Method', 'Identifier System', 'Installed App', 'Server Script', 'Workflow', 'Assignment Rule', ...SCOPE_TABLES])
      expect(SECURITY_TABLES.has(t), t).toBe(true)
  })

  test('a Permission row granting full access to a security table does not let a non-manager write it', async ({ admin, createUser }) => {
    const role = 'Security Writer 437'
    const user = await createUserWithRole(admin, createUser, { role, table: ['Role', 'Permission', 'Data Scope', 'Share', 'Identifier System'], ...ALL_ACTIONS })
    await expectApiError(user.post('/api/save_row', { table: 'Role', row: { row_id: 'Escalated 437' } }), { status: 403 })
    await expectApiError(
      user.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role, ...ALL_ACTIONS } }),
      { status: 403 },
    )
    await expectApiError(
      user.post('/api/save_row', { table: 'Data Scope', row: { person: user.user, allow_table: 'Person', for_value: user.user } }),
      { status: 403 },
    )
    await expectApiError(
      user.post('/api/save_row', { table: 'Share', row: { share_table: 'Person', share_name: user.user, person: user.user, read: true, write: true } }),
      { status: 403 },
    )
    // Reads stay governed by the grant.
    const perms = await user.get<{ data: unknown[] }>(tableRef('Permission').listUrl({ fields: ['row_id'] }))
    expect(perms.data.length).toBeGreaterThan(0)
  })

  test('update, delete and rename of an existing security row are refused too', async ({ admin, createUser }) => {
    const role = 'Security Editor 437'
    const user = await createUserWithRole(admin, createUser, { role, table: ['Permission', 'Role'], ...ALL_ACTIONS })
    const [permId] = await grantRole(admin, { role, table: 'Person', can_read: true })
    const perm = await admin.get<{ updated_at: string }>(tableRef('Permission').rowUrl(permId))
    await expectApiError(patchDoc(user, tableRef('Permission').rowUrl(permId), { updated_at: perm.updated_at, can_write: true }), { status: 403 })
    await expectApiError(user.delete(tableRef('Permission').rowUrl(permId)), { status: 403 })
    await expectApiError(
      user.post(`${tableRef('Role').rowUrl(role)}:rename`, { new_name: 'Renamed 437' }),
      { status: 403 },
    )
  })

  test('the sign-in configuration refuses a non-manager', async ({ admin, createUser }) => {
    const role = 'Sign In Writer 437'
    const user = await createUserWithRole(admin, createUser, { role, table: ['Sign In Method'], ...ALL_ACTIONS })
    const pw = await admin.get<{ updated_at: string }>(tableRef('Sign In Method').rowUrl('password'))
    await expectApiError(patchDoc(user, tableRef('Sign In Method').rowUrl('password'), { updated_at: pw.updated_at, new_person: 'create' }), { status: 403 })
  })

  test('the Sales Target scope tables refuse a non-manager writer, but reads follow the grant', async ({ admin, createUser }) => {
    await makeTable(admin, { name: 'Store Manager', columns: ['store_code', 'employee_code'] })
    const role = 'Scope Writer 437'
    const user = await createUserWithRole(admin, createUser, { role, table: ['Store Manager'], ...ALL_ACTIONS })
    await expectApiError(user.post(tableRef('Store Manager').url, { store_code: '1501', employee_code: 'E-1' }), { status: 403 })
    await admin.post(tableRef('Store Manager').url, { store_code: '1501', employee_code: 'E-2' })
    const rows = await user.get<{ data: unknown[] }>(tableRef('Store Manager').listUrl({ fields: ['row_id'] }))
    expect(rows.data).toHaveLength(1)
  })

  test('the import path is refused too', async ({ admin, createUser }) => {
    await makeTable(admin, { name: 'Employee Section Map', columns: ['store_code', 'employee_code'] })
    const user = await createUserWithRole(admin, createUser, { role: 'Scope Importer 437', table: ['Employee Section Map'], ...ALL_ACTIONS })
    await expectApiError(
      user.post(`${tableRef('Employee Section Map').url}:import`, { rows: [{ store_code: '1501', employee_code: 'E-1' }] }),
      { status: 403 },
    )
    expect((await admin.get<{ count: number }>(`${tableRef('Employee Section Map').url}:count`)).count).toBe(0)
  })

  test('server-side callers acting for a non-manager are refused; a trusted bypass does not lift the guard', async ({ createUser }) => {
    const plain = await createUser({ roles: [] })
    await expect(saveDoc('Role', { row_id: 'Server Side 437' }, plain.user!, 'insert')).rejects.toMatchObject({ type: 'PermissionError' })
    await expect(saveDoc('Role', { row_id: 'Bypass 437' }, plain.user!, 'insert', { skipPermissions: true })).rejects.toMatchObject({ type: 'PermissionError' })
    await expect(deleteDoc('Role', 'System Manager', plain.user!)).rejects.toMatchObject({ type: 'PermissionError' })
  })

  test('a System Manager writes every security table', async ({ admin, createUser }) => {
    const manager = await createUser({ roles: ['System Manager'] })
    await manager.post('/api/save_row', { table: 'Role', row: { row_id: 'Managed 437' } })
    await manager.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Managed 437', can_read: true } })
    await manager.post('/api/save_row', { table: 'Data Scope', row: { person: manager.user, allow_table: 'Person', for_value: manager.user } })
    await makeTable(admin, { name: 'Section Ownership', columns: ['store_code'] })
    await manager.post(tableRef('Section Ownership').url, { store_code: '1501' })
  })
})

const FLOW = {
  states: [{ state: 'true', target_status: 'draft' }, { state: 'false', target_status: 'draft' }],
  transitions: [{ state: 'true', action: 'Disable', next_state: 'false', allowed: 'System Manager' }],
}

describe('#437: nothing that runs during a save, or on its own, opens access', () => {
  test('a Document Event script that changes enabled or roles is judged on what it leaves behind', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const target = await makePerson({ full_name: 'Scripted' })
    await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: 'ss-437-enabled', script_type: 'Document Event', ref_table: 'Person', event: 'before_save', script: 'doc.enabled = false', enabled: true } })
    let doc = await loaded(admin, target)
    await expectApiError(patchDoc(editor, PERSON.rowUrl(target), { updated_at: doc.updated_at, full_name: 'Renamed' }), { status: 403 })
    expect((await loaded(admin, target)).enabled).toBe(true)
    await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: 'ss-437-enabled', updated_at: (await admin.get<{ updated_at: string }>(tableRef('Server Script').rowUrl('ss-437-enabled'))).updated_at, enabled: false } })
    await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: 'ss-437-roles', script_type: 'Document Event', ref_table: 'Person', event: 'before_save', script: 'doc.roles = [{ role: "System Manager" }]', enabled: true } })
    doc = await loaded(admin, target)
    await expectApiError(patchDoc(editor, PERSON.rowUrl(target), { updated_at: doc.updated_at, full_name: 'Renamed' }), { status: 403 })
    await expectApiError(editor.post(PERSON.url, { full_name: 'Created' }), { status: 403 })
    expect((await loaded(admin, target)).roles).toEqual([])
    // The same script under a System Manager is their decision to make.
    const manager = await createUser({ roles: ['System Manager'] })
    await patchDoc(manager, PERSON.rowUrl(target), { updated_at: doc.updated_at, full_name: 'Renamed' })
    expect((await loaded(admin, target)).roles.map((r) => r.role)).toEqual(['System Manager'])
  })

  test('a script that leaves enabled as a non-boolean is refused, whoever saves', async ({ admin, createUser }) => {
    // The driver writes anything but `true` as false: "true" or 1 would look
    // unchanged and still disable the person.
    const editor = await personEditor(admin, createUser)
    const manager = await createUser({ roles: ['System Manager'] })
    const target = await makePerson({ full_name: 'Typed' })
    for (const value of ['"true"', '1', '"false"', 'null']) {
      const id = `ss-437-type-${value.replace(/\W/g, '')}`
      await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: id, script_type: 'Document Event', ref_table: 'Person', event: 'before_save', script: `doc.enabled = ${value}`, enabled: true } })
      for (const writer of [editor, manager]) {
        const doc = await loaded(admin, target)
        await expectApiError(patchDoc(writer, PERSON.rowUrl(target), { updated_at: doc.updated_at, full_name: 'Renamed' }), { status: 417 })
        expect((await loaded(admin, target)).enabled).toBe(true)
      }
      await expectApiError(editor.post(PERSON.url, { full_name: 'Created' }), { status: 417 })
      await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: id, updated_at: (await admin.get<{ updated_at: string }>(tableRef('Server Script').rowUrl(id))).updated_at, enabled: false } })
    }
    // A real boolean left unchanged still saves.
    const doc = await loaded(admin, target)
    await patchDoc(editor, PERSON.rowUrl(target), { updated_at: doc.updated_at, full_name: 'Renamed', enabled: true })
  })

  test('a script that retypes a role row is not taken as unchanged', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const target = await makePerson({ full_name: 'Role typed', roles: [{ role: EDITOR }] })
    await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: 'ss-437-role-type', script_type: 'Document Event', ref_table: 'Person', event: 'before_save', script: 'doc.roles = (doc.roles || []).map((r) => ({ row_id: r.row_id, role: [r.role] }))', enabled: true } })
    const doc = await loaded(admin, target)
    await expectApiError(patchDoc(editor, PERSON.rowUrl(target), { updated_at: doc.updated_at, full_name: 'Renamed', roles: doc.roles }), { status: 403 })
    expect((await loaded(admin, target)).roles.map((r) => r.role)).toEqual([EDITOR])
  })

  test('a grant on Server Script, Workflow or Assignment Rule does not let a non-manager write them', async ({ admin, createUser }) => {
    const user = await createUserWithRole(admin, createUser, { role: 'Automation Writer 437', table: ['Server Script', 'Workflow', 'Assignment Rule'], ...ALL_ACTIONS })
    await expectApiError(user.post('/api/save_row', { table: 'Server Script', row: { row_id: 'ss-437-x', script_type: 'Document Event', ref_table: 'Person', event: 'before_save', script: 'doc.enabled = true', enabled: true } }), { status: 403 })
    await expectApiError(user.post('/api/save_row', { table: 'Workflow', row: { row_id: 'Wf 437 x', ref_table: 'Person', is_active: false } }), { status: 403 })
    await expectApiError(user.post('/api/save_row', { table: 'Assignment Rule', row: { row_id: 'Ar 437 x', ref_table: 'Person' } }), { status: 403 })
  })

  test('a Workflow may not drive an access column or a security Table', async ({ admin }) => {
    for (const row of [
      { row_id: 'Wf 437 enabled', ref_table: 'Person', state_field: 'enabled', is_active: false, ...FLOW },
      { row_id: 'Wf 437 role', ref_table: 'Role', is_active: false, ...FLOW },
    ])
      await expectApiError(admin.post('/api/save_row', { table: 'Workflow', row }), { status: 417, message: expect.stringMatching(/decides who can do what/) })
  })

  test('a Workflow saved before that rule cannot move an access column either', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const target = await makePerson({ full_name: 'Flowed' })
    await sql`insert into workflow (row_id, ref_table, state_field, is_active) values ('Wf 437 legacy', 'Person', 'enabled', true)`
    await sql`insert into workflow_transition (row_id, parent, parenttype, parentfield, state, action, next_state, allowed)
      values ('wt437', 'Wf 437 legacy', 'Workflow', 'transitions', 'true', 'Disable', 'false', ${EDITOR})`
    await expectApiError(
      editor.post(`${PERSON.rowUrl(target)}:apply_workflow_action`, { action: 'Disable' }),
      { status: 417, message: expect.stringMatching(/decides who can do what/) },
    )
    expect((await loaded(admin, target)).enabled).toBe(true)
  })

  test('an Assignment Rule may not stamp an access column or a security Table', async ({ admin }) => {
    for (const row of [
      { row_id: 'Ar 437 enabled', ref_table: 'Person', assign_to_field: 'enabled' },
      { row_id: 'Ar 437 scope', ref_table: 'Data Scope', assign_to_field: 'person' },
    ])
      await expectApiError(admin.post('/api/save_row', { table: 'Assignment Rule', row }), { status: 417, message: expect.stringMatching(/decides who can do what/) })
  })

  test('an Assignment Rule saved before that rule does not act on access data', async ({ createUser }) => {
    const owner = await createUser({ roles: [] })
    const other = await createUser({ roles: [] })
    const scope = await saveDoc('Data Scope', { person: owner.user, allow_table: 'Person', for_value: owner.user })
    await sql`insert into assignment_rule (row_id, ref_table, assign_to_field, disabled) values ('Ar 437 legacy', 'Data Scope', 'person', false)`
    await sql`insert into assignment_rule_user (row_id, parent, parenttype, parentfield, "user", position)
      values ('aru437', 'Ar 437 legacy', 'Assignment Rule', 'users', ${other.user}, 1)`
    await evaluateAssignmentRules('Data Scope', { ...scope })
    const [after] = await sql`select person from data_scope where row_id = ${String(scope.row_id)}`
    expect(after.person).toBe(owner.user)
  })
})

describe('Only a System Manager changes who can do what', () => {
  test('a delete grant on people removes a person together with their roles', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const target = await makePerson({ full_name: 'Leaving', roles: [{ role: EDITOR }] })
    expect((await editor.fetch(PERSON.rowUrl(target), { method: 'DELETE' })).status).toBe(200)
    expect(await sql`select 1 from person where row_id = ${target}`).toHaveLength(0)
    expect(await sql`select role from has_role where parent = ${target}`).toEqual([])
  })

  test('a person created by someone allowed to add people starts enabled with no roles', async ({ admin, createUser }) => {
    const editor = await personEditor(admin, createUser)
    const created = await editor.post<{ row_id: string }>(PERSON.url, { full_name: 'Fresh Starter' })
    const doc = await loaded(admin, created.row_id)
    expect(doc.enabled).toBe(true)
    expect(doc.roles).toEqual([])
  })
})
