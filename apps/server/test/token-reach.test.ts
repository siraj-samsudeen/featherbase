import { expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { expectRefused, expectStatus, grantRole } from './fixtures'

// #852: before a token is issued, the Access tokens screen says what its owner
// can reach, so a token that can do nothing useful is caught before it is used.
// Every principal also holds the built-in All role, so the answer comes from
// the permission check itself, not from the owner's role list.

type Reach = { every_table: boolean; own_roles: boolean; own_reach: boolean; read: { table: string; own_rows: boolean }[]; change: { table: string; own_rows: boolean }[] }
const names = (list: { table: string }[]) => list.map((t) => t.table)

const reachOf = (owner: string) => `/api/access_tokens/reach?owner=${encodeURIComponent(owner)}`

test('a new service account has no role of its own and reaches only what All grants', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Reach Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-new' })
  const reach = await admin.get<Reach>(reachOf(account.row_id))
  expect(reach).toMatchObject({ every_table: false, own_roles: false, own_reach: false, change: [] })
  expect(names(reach.read)).not.toContain('Reach Zone')
})

test('a role adds the Tables it grants, to read and to change', async ({ admin }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-importer' })
  const before = await admin.get<Reach>(reachOf(account.row_id))

  await admin.post('/api/table_def', { name: 'Reach Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Reach Reader' } })
  await grantRole(admin, { table: 'Reach Zone', role: 'Reach Reader', can_read: true })
  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Reach Reader'] })
  const withReader = await admin.get<Reach>(reachOf(account.row_id))
  expect(withReader).toMatchObject({ every_table: false, own_roles: true, own_reach: true, change: before.change })
  expect(names(withReader.read)).toEqual([...names(before.read), 'Reach Zone'].sort())
  expect(withReader.read.find((t) => t.table === 'Reach Zone')?.own_rows).toBe(false)

  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Reach Writer' } })
  await grantRole(admin, { table: 'Reach Zone', role: 'Reach Writer', can_write: true })
  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Reach Reader', 'Reach Writer'] })
  expect(names((await admin.get<Reach>(reachOf(account.row_id))).change)).toEqual([...names(before.change), 'Reach Zone'].sort())
})

test('the reach matches what the token can really do', async ({ admin, api }) => {
  await admin.post('/api/table_def', { name: 'Reach Bin', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-checker' })
  const { token } = await admin.post<{ token: string }>('/api/access_tokens', { label: 'check', owner: account.row_id })
  const asToken = { headers: { authorization: `Bearer ${token}` } }

  expect(names((await admin.get<Reach>(reachOf(account.row_id))).read)).not.toContain('Reach Bin')
  await expectStatus(await api.fetch('/api/table/Reach%20Bin', asToken), 403)

  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Bin Reader' } })
  await grantRole(admin, { table: 'Reach Bin', role: 'Bin Reader', can_read: true })
  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Bin Reader'] })
  expect(names((await admin.get<Reach>(reachOf(account.row_id))).read)).toContain('Reach Bin')
  await expectStatus(await api.fetch('/api/table/Reach%20Bin', asToken), 200)
})

test('a System Manager owner reaches every Table', async ({ admin }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-admin', roles: ['System Manager'] })
  expect((await admin.get<Reach>(reachOf(account.row_id))).every_table).toBe(true)
  expect((await admin.get<Reach>(reachOf('Administrator'))).every_table).toBe(true)
})

test('only a System Manager may ask about another owner; anyone may ask about themselves', async ({ admin, createUser }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-private' })
  const person = await createUser({ roles: [] })
  await expectRefused(person.get(reachOf(account.row_id)), 403)
  expect((await person.get<Reach>(reachOf(person.user!))).every_table).toBe(false)
})

test('a grant for its own rows only is marked as such; a full grant on the same Table outranks it', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Reach Order', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-own-rows' })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Order Own Writer' } })
  await grantRole(admin, { table: 'Reach Order', role: 'Order Own Writer', can_read: true, can_write: true, own_rows_only: true })
  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Order Own Writer'] })
  const own = await admin.get<Reach>(reachOf(account.row_id))
  expect(own.change.find((t) => t.table === 'Reach Order')).toEqual({ table: 'Reach Order', own_rows: true, roles: ['Order Own Writer'] })

  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Order Writer' } })
  await grantRole(admin, { table: 'Reach Order', role: 'Order Writer', can_read: true, can_write: true })
  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Order Own Writer', 'Order Writer'] })
  const full = await admin.get<Reach>(reachOf(account.row_id))
  expect(full.change.find((t) => t.table === 'Reach Order')).toEqual({ table: 'Reach Order', own_rows: false, roles: ['Order Own Writer', 'Order Writer'] })
})

test('a role that grants nothing reaches nothing beyond what every account can', async ({ admin }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-empty-role' })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Empty Role' } })
  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Empty Role'] })
  expect(await admin.get<Reach>(reachOf(account.row_id))).toMatchObject({ own_roles: true, own_reach: false, change: [] })
})

test('a Table whose mandatory access admits none of the owner\'s roles is not reached', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Reach Vault', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await sql`update table_def set access_policy='{"version":1,"roles":["Vault Member"]}'::jsonb where name='Reach Vault'`
  invalidateMeta('Reach Vault')
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'reach-vault' })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Vault Reader' } })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Vault Member' } })
  await grantRole(admin, { table: 'Reach Vault', role: 'Vault Reader', can_read: true })
  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Vault Reader'] })
  expect(names((await admin.get<Reach>(reachOf(account.row_id))).read)).not.toContain('Reach Vault')

  await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['Vault Reader', 'Vault Member'] })
  expect(names((await admin.get<Reach>(reachOf(account.row_id))).read)).toContain('Reach Vault')
})

test('asking with no owner answers for the caller', async ({ admin }) => {
  expect(await admin.get<Reach>('/api/access_tokens/reach')).toEqual(await admin.get<Reach>(reachOf('Administrator')))
})
