import { expect } from 'vitest'
import { test } from './pg-test'

// #852: before a token is issued, the Access tokens screen says what its owner
// can reach, so a token that can do nothing useful is caught before it is used.
// Every principal also holds the built-in All role, so the answer comes from
// the permission check itself, not from the owner's role list.

type Reach = { every_table: boolean; own_roles: boolean; read: string[]; change: string[] }

const reachOf = (owner: string) => `/api/access_tokens/reach?owner=${encodeURIComponent(owner)}`

test('a new service account has no role of its own and reaches only what All grants', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Reach Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-new' })
  const reach = await admin.get<Reach>(reachOf(account.row_id))
  expect(reach).toMatchObject({ every_table: false, own_roles: false, change: [] })
  expect(reach.read).not.toContain('Reach Zone')
})

test('a role adds the Tables it grants, to read and to change', async ({ admin }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-importer' })
  const before = await admin.get<Reach>(reachOf(account.row_id))

  await admin.post('/api/table_def', { name: 'Reach Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Reach Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Reach Zone', role: 'Reach Reader', can_read: true } })
  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Reach Reader'] })
  expect(await admin.get<Reach>(reachOf(account.row_id))).toEqual({
    every_table: false, own_roles: true, read: [...before.read, 'Reach Zone'].sort(), change: before.change,
  })

  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Reach Writer' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Reach Zone', role: 'Reach Writer', can_write: true } })
  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Reach Reader', 'Reach Writer'] })
  expect((await admin.get<Reach>(reachOf(account.row_id))).change).toEqual([...before.change, 'Reach Zone'].sort())
})

test('the reach matches what the token can really do', async ({ admin, api }) => {
  await admin.post('/api/table_def', { name: 'Reach Bin', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-checker' })
  const { token } = await admin.post<{ token: string }>('/api/access_tokens', { label: 'check', owner: account.row_id })
  const asToken = { headers: { authorization: `Bearer ${token}` } }

  expect((await admin.get<Reach>(reachOf(account.row_id))).read).not.toContain('Reach Bin')
  expect((await api.fetch('/api/table/Reach%20Bin', asToken)).status).toBe(403)

  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Bin Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Reach Bin', role: 'Bin Reader', can_read: true } })
  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Bin Reader'] })
  expect((await admin.get<Reach>(reachOf(account.row_id))).read).toContain('Reach Bin')
  expect((await api.fetch('/api/table/Reach%20Bin', asToken)).status).toBe(200)
})

test('a System Manager owner reaches every Table', async ({ admin }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-admin', roles: ['System Manager'] })
  expect((await admin.get<Reach>(reachOf(account.row_id))).every_table).toBe(true)
  expect((await admin.get<Reach>(reachOf('Administrator'))).every_table).toBe(true)
})

test('only a System Manager may ask about another owner; anyone may ask about themselves', async ({ admin, createUser }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-private' })
  const person = await createUser({ roles: [] })
  await expect(person.get(reachOf(account.row_id))).rejects.toMatchObject({ status: 403 })
  expect((await person.get<Reach>(reachOf(person.user!))).every_table).toBe(false)
})
