// #437: who-can-do-what is System Manager territory. The tables that decide
// access refuse writes from anyone else whatever the Permission rows say, and
// a Person's roles and enabled flag change only for a System Manager.
import { describe, expect } from 'vitest'
import { test, patchDoc } from './pg-test'
import { createUserWithRole, expectApiError, grantRole, makePerson, makeTable, tableRef } from './fixtures'
import { SECURITY_TABLES } from '../src/security-tables'
import { saveDoc, deleteDoc } from '../src/document'
import type { TestClient } from 'feather-testing-postgres'

const PERSON = tableRef('Person')
const EDITOR = 'Person Editor 437'
const ALL_ACTIONS = { can_read: true, can_write: true, can_create: true, can_delete: true }

async function personEditor(admin: TestClient, createUser: Parameters<typeof createUserWithRole>[1]) {
  return createUserWithRole(admin, createUser, { role: EDITOR, table: 'Person', ...ALL_ACTIONS })
}

async function loaded(admin: TestClient, id: string) {
  return admin.get<Record<string, unknown> & { roles: { role: string }[] }>(PERSON.rowUrl(id))
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
      await expectApiError(editor.post(`${PERSON.url}:import`, { key_column: 'username', rows: [row] }), { status: 403, message: /System Manager/ })
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
    for (const t of ['Permission', 'Role', 'Has Role', 'Data Scope', 'Share', 'Sign In Method', 'Identifier System', 'Installed App', ...SCOPE_TABLES])
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
