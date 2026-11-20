import { expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { appCatalog } from '../src/runtime-packages'
import manifest from '../../../client-apps/jeyarama/budgets/featherbase.json'
import { budgetsClient, EDITOR, installBudgets, VIEWER, world, type Row } from './jeyarama-budgets-world'

const TABLES = manifest.tables.map(table => table.name)

test('the app declares Budget Editor and Budget Viewer, and maps neither to anyone', () => {
  expect(manifest.roles).toEqual(['Budget Editor', 'Budget Viewer'])
  expect('roleDefaults' in manifest).toBe(false)
})

test('every Budgets table has a ceiling naming only the two roles', () => {
  for (const table of manifest.tables)
    expect(table.access_policy, table.name).toEqual({ version: 1, roles: ['Budget Editor', 'Budget Viewer'] })
})

test('a person with neither role reads no Budgets table, a System Manager included', async ({ createUser }) => {
  const admin = await createUser({ roles: ['System Manager'] })
  await installBudgets(admin)
  const editor = budgetsClient(await createUser({ roles: EDITOR }))
  await world(editor)
  const stranger = budgetsClient(await createUser({ roles: ['Featherbase Viewer'] }))
  for (const table of TABLES) {
    await expect(stranger.get(`/api/table/${table}?fields=["row_id"]`), table).rejects.toMatchObject({ status: 403 })
    await expect(budgetsClient(admin).get(`/api/table/${table}?fields=["row_id"]`), table).rejects.toMatchObject({ status: 403 })
  }
})

test('the app is listed only for someone holding one of its roles', async ({ createUser }) => {
  const admin = await createUser({ roles: ['System Manager'] })
  await installBudgets(admin)
  const opens = async (client: TestClient) => (await appCatalog(client.user!)).some(app => app.name === 'budgets')
  expect(await opens(await createUser({ roles: VIEWER }))).toBe(true)
  expect(await opens(await createUser({ roles: EDITOR }))).toBe(true)
  expect(await opens(await createUser({ roles: ['Featherbase Viewer'] }))).toBe(false)
  expect(await opens(admin)).toBe(false)
})

test('a Budget Viewer reads every table and changes none; a Budget Editor changes them', async ({ createUser }) => {
  const admin = await createUser({ roles: ['System Manager'] })
  await installBudgets(admin)
  const editor = budgetsClient(await createUser({ roles: EDITOR }))
  const viewer = budgetsClient(await createUser({ roles: VIEWER }))
  const made = await world(editor)
  for (const table of TABLES)
    expect((await viewer.get<{ data: Row[] }>(`/api/table/${table}?fields=["row_id"]`)).data.length, table).toBeGreaterThan(0)
  await expect(viewer.post('/api/save_row', { table: 'budgets.pl_line', row: { line_key: 'extra', line_name: 'Extra', level: 'Published', line_order: 999, section: 'Store Opex', line_kind: 'Posted', sign: 'Cost' } }))
    .rejects.toMatchObject({ status: 403 })
  await expect(viewer.post('/api/save_row', { table: 'budgets.gl_account', row: { row_id: made.account.row_id, updated_at: made.account.updated_at, note: 'changed' } }))
    .rejects.toMatchObject({ status: 403 })
  const changed = await editor.post<Row>('/api/save_row', { table: 'budgets.gl_account', row: { row_id: made.account.row_id, updated_at: made.account.updated_at, note: 'changed' } })
  expect(changed.note).toBe('changed')
})
