// #1380: what the Budgets app's server keeps true on every save, and its operations.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import manifest from '../../../client-apps/jeyarama/budgets/featherbase.json'
import { invalidateSources } from '../src/sources/registry'
import { budgetsClient, EDITOR, installBudgets, VIEWER, world, type Row } from './jeyarama-budgets-world'

type Create = (options: { roles: string[] }) => Promise<TestClient>
async function setup(createUser: Create) {
  const admin = await createUser({ roles: ['System Manager'] })
  await installBudgets(admin)
  const editor = budgetsClient(await createUser({ roles: EDITOR }))
  const viewer = budgetsClient(await createUser({ roles: VIEWER }))
  const made = await world(editor)
  const save = (table: string, row: Record<string, unknown>) => editor.post<Row>('/api/save_row', { table: `budgets.${table}`, row })
  const act = <T = Record<string, unknown>>(client: TestClient, name: string, payload: unknown) =>
    client.post<{ result: T }>(`/api/app_actions/budgets/${name}`, { idempotencyKey: crypto.randomUUID(), payload }).then(r => r.result)
  const rows = (table: string, filters: unknown[] = []) =>
    editor.get<{ data: Row[] }>(`/api/table/budgets.${table}?fields=${encodeURIComponent(JSON.stringify(['row_id', 'updated_at', ...manifest.tables.find(t => t.name === `budgets.${table}`)!.columns.map(c => c.column_name)]))}&filters=${encodeURIComponent(JSON.stringify(filters))}&order_by=${encodeURIComponent('created_at asc')}`).then(r => r.data)
  const get = async (table: string, id: string) => (await rows(table, [['row_id', '=', id]]))[0]
  return { admin, editor, viewer, made, save, act, rows, get }
}

test('a P&L line: a working line rolls into a published line, and a subtotal says how it adds', async ({ createUser }) => {
  const { save, made } = await setup(createUser)
  const line = { level: 'Working', line_order: 420, section: 'Store Opex', line_kind: 'Posted', sign: 'Cost' }
  await expect(save('pl_line', { ...line, line_key: 'pf', line_name: 'PF' })).rejects.toThrow('A working line rolls into a published line: choose it')
  await expect(save('pl_line', { ...line, line_key: 'pf', line_name: 'PF', rolls_into: made.salaries.row_id })).rejects.toThrow('Salaries is a working line: roll into a published line')
  await expect(save('pl_line', { ...line, level: 'Published', line_key: 'x', line_name: 'X', rolls_into: made.manpower.row_id })).rejects.toThrow('A published line rolls into nothing')
  await expect(save('pl_line', { ...line, level: 'Published', line_kind: 'Subtotal', line_key: 'store_ebitda', line_name: 'Store EBITDA' })).rejects.toThrow('Say how this subtotal adds: Running Total or Section Total')
  expect((await save('pl_line', { ...line, line_key: 'pf', line_name: 'PF', rolls_into: made.manpower.row_id })).row_id).toBe('pf')
})

test('an account is classified to a working line', async ({ createUser }) => {
  const { save, made } = await setup(createUser)
  await expect(save('gl_account', { row_id: made.account.row_id, updated_at: made.account.updated_at, pl_line: made.manpower.row_id }))
    .rejects.toThrow('Manpower Cost is a published line: classify an account to one of its working lines')
})

test('a budget amount: on a draft P&L version, a published line that is not a subtotal, a month it covers, once', async ({ createUser }) => {
  const { save, made, act } = await setup(createUser)
  const cell = { budget_version: made.version.row_id, plant: '9003', budget_month: '2026-11-01', pl_line: made.manpower.row_id, amount: 100 }
  await expect(save('pl_budget', { ...cell, pl_line: made.salaries.row_id })).rejects.toThrow('Salaries is a working line: a budget is held on published lines')
  await expect(save('pl_budget', { ...cell, budget_month: '2027-04-01' })).rejects.toThrow("Apr'27 is outside the months FY27 Original covers")
  await expect(save('pl_budget', { ...cell, budget_month: '2026-10-01' })).rejects.toThrow("FY27 Original already has Manpower Cost for 9003 in Oct'26: change that amount")
  await expect(save('pl_budget', { ...cell, budget_version: made.sales.row_id })).rejects.toThrow('FY27 Sales Original is a Sales version: a P&L amount goes on a P&L version')
  const kept = await save('pl_budget', { ...cell, budget_month: '2026-11-15' })
  expect(String(kept.budget_month).slice(0, 10)).toBe('2026-11-01')
  await act(await approver(createUser), 'approve_version', { version: made.version.row_id })
  await expect(save('pl_budget', { ...cell, budget_month: '2026-12-01' })).rejects.toThrow('FY27 Original is approved: revise it to change a figure')
  await expect(save('pl_budget', { row_id: kept.row_id, updated_at: kept.updated_at, amount: 5 })).rejects.toThrow('FY27 Original is approved: revise it to change a figure')
})
const approver = async (createUser: Create) => budgetsClient(await createUser({ roles: EDITOR }))

test('a version: its months are in order, and only Approve approves it', async ({ createUser }) => {
  const { save, made, act, get, editor, viewer } = await setup(createUser)
  await expect(save('budget_version', { version_name: 'Bad', budget_kind: 'P&L', fiscal_year: 'FY27', covers_from: '2026-10-01', covers_to: '2026-04-01' })).rejects.toThrow('Covers From is after Covers To')
  await expect(save('budget_version', { row_id: made.version.row_id, updated_at: made.version.updated_at, version_state: 'Approved' })).rejects.toThrow('Approve a version with Approve, so who and when are recorded')
  await expect(act(viewer, 'approve_version', { version: made.version.row_id })).rejects.toMatchObject({ status: 403 })
  await act(editor, 'approve_version', { version: made.version.row_id })
  const approved = await get('budget_version', made.version.row_id)
  expect(approved).toMatchObject({ version_state: 'Approved', approved_by: editor.user })
  expect(String(approved.approved_on).slice(0, 10)).toBe(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10))
  await expect(save('budget_version', { row_id: approved.row_id, updated_at: approved.updated_at, covers_to: '2026-12-01' })).rejects.toThrow('FY27 Original is approved: only its note can change, or withdraw it')
  expect((await save('budget_version', { row_id: approved.row_id, updated_at: approved.updated_at, note: 'Board, April' })).note).toBe('Board, April')
})

test('pasted budget amounts are added, and pasted again they change the same rows', async ({ createUser }) => {
  const { made, act, rows, editor, viewer } = await setup(createUser)
  const values = [
    { plant: '9003', pl_line: made.manpower.row_id, budget_month: '2026-10-01', amount: 1900000 },
    { plant: '9004', pl_line: made.manpower.row_id, budget_month: '2026-10-01', amount: 900000 },
  ]
  await expect(act(viewer, 'paste_budget', { version: made.version.row_id, values })).rejects.toMatchObject({ status: 403 })
  expect(await act(editor, 'paste_budget', { version: made.version.row_id, values })).toEqual({ added: 1, changed: 1 })
  expect(await act(editor, 'paste_budget', { version: made.version.row_id, values: [{ ...values[1], amount: 950000 }] })).toEqual({ added: 0, changed: 1 })
  const kept = await rows('pl_budget', [['budget_version', '=', made.version.row_id]])
  expect(kept.map(row => [row.plant, Number(row.amount)]).sort()).toEqual([['9003', 1900000], ['9004', 950000]])
})

test('revising a version makes a draft for the chosen months with the old figures in it', async ({ createUser }) => {
  const { made, act, rows, get, editor } = await setup(createUser)
  await act(editor, 'paste_budget', { version: made.version.row_id, values: [
    { plant: '9003', pl_line: made.manpower.row_id, budget_month: '2026-09-01', amount: 1 },
    { plant: '9003', pl_line: made.manpower.row_id, budget_month: '2026-12-01', amount: 3 },
  ] })
  const { version } = await act<{ version: string }>(editor, 'revise_version', { version: made.version.row_id, version_name: 'FY27 Revision 1', covers_from: '2026-10-01', covers_to: '2027-03-01' })
  expect(await get('budget_version', version)).toMatchObject({ version_name: 'FY27 Revision 1', version_state: 'Draft', based_on: made.version.row_id, budget_kind: 'P&L', operating_region: 'North', fiscal_year: 'FY27' })
  const copied = await rows('pl_budget', [['budget_version', '=', version]])
  expect(copied.map(row => [String(row.budget_month).slice(0, 7), Number(row.amount)]).sort()).toEqual([['2026-10', 1840000], ['2026-12', 3]])
  await expect(act(editor, 'revise_version', { version: made.version.row_id, version_name: 'X', covers_from: '2026-01-01', covers_to: '2026-06-01' })).rejects.toThrow("A revision covers months inside the version it revises (Apr'26 to Mar'27)")
})

test('an adjustment takes its line from its account and starts with all of it remaining', async ({ createUser }) => {
  const { made, save, get } = await setup(createUser)
  expect(await get('close_adjustment', made.adjustment.row_id)).toMatchObject({ pl_line: made.salaries.row_id, adjustment_state: 'Open' })
  expect(Number((await get('close_adjustment', made.adjustment.row_id)).remaining_amount)).toBe(42500)
  const unclassified = await save('gl_account', { account_code: '49990002', account_name: 'Not Classified Yet', statement: 'P&L' })
  await expect(save('close_adjustment', { month_close: made.close.row_id, plant: '9003', gl_account: unclassified.row_id, amount: 5, adjustment_type: 'Provision', reason: 'x' }))
    .rejects.toThrow('Not Classified Yet has no P&L line yet: classify it first')
})

test('pasted adjustments become lines of the close; a viewer cannot paste', async ({ createUser }) => {
  const { made, act, rows, editor, viewer } = await setup(createUser)
  const values = [
    { plant: '9003', gl_account: '49990001', amount: 1200, adjustment_type: 'Reallocation', reason: 'Moved from head office' },
    { plant: '9004', gl_account: '49990001', amount: -1200, adjustment_type: 'Reallocation', reason: 'Moved from head office' },
  ]
  await expect(act(viewer, 'paste_adjustments', { close: made.close.row_id, values })).rejects.toMatchObject({ status: 403 })
  expect(await act(editor, 'paste_adjustments', { close: made.close.row_id, values })).toEqual({ added: 2 })
  const moved = (await rows('close_adjustment', [['reason', '=', 'Moved from head office']]))
  expect(moved.map(row => [row.plant, Number(row.amount), Number(row.remaining_amount), row.pl_line])).toEqual([['9003', 1200, 1200, made.salaries.row_id], ['9004', -1200, -1200, made.salaries.row_id]])
})

test('matching an adjustment to an SAP document leaves what remains, and settles it at nothing', async ({ createUser }) => {
  const { made, act, get, editor, viewer } = await setup(createUser)
  const id = made.adjustment.row_id
  await expect(act(viewer, 'match_adjustment', { adjustment: id, document: '1900019201', amount: 40000 })).rejects.toMatchObject({ status: 403 })
  await act(editor, 'match_adjustment', { adjustment: id, document: '1900019201', amount: 40000 })
  let line = await get('close_adjustment', id)
  expect([line.adjustment_state, line.matched_sap_document, Number(line.matched_amount), Number(line.remaining_amount)]).toEqual(['Open', '1900019201', 40000, 2500])
  await act(editor, 'match_adjustment', { adjustment: id, document: '1900019388', amount: 2500 })
  line = await get('close_adjustment', id)
  expect([line.adjustment_state, line.matched_sap_document, Number(line.matched_amount), Number(line.remaining_amount)]).toEqual(['Posted In SAP', '1900019201, 1900019388', 42500, 0])
  await expect(act(editor, 'match_adjustment', { adjustment: id, document: '1', amount: 1 })).rejects.toThrow('Nothing remains to match on this adjustment')
})

test('several adjustments change state, owner or type together', async ({ createUser }) => {
  const { made, act, rows, editor } = await setup(createUser)
  await act(editor, 'paste_adjustments', { close: made.close.row_id, values: [{ plant: '9004', gl_account: '49990001', amount: 7, adjustment_type: 'Provision', reason: 'Second' }] })
  const ids = (await rows('close_adjustment')).map(row => row.row_id)
  expect(await act(editor, 'set_adjustments', { adjustments: ids, change: { adjustment_state: 'Carried Forward', owner: editor.user } })).toEqual({ changed: 2 })
  expect((await rows('close_adjustment')).map(row => [row.adjustment_state, row.owner])).toEqual([['Carried Forward', editor.user], ['Carried Forward', editor.user]])
  await expect(act(editor, 'set_adjustments', { adjustments: ids, change: { amount: 1 } })).rejects.toThrow('Together, adjustments change their state, owner or type')
})

test('a close is one company, month and version; publishing makes it read-only; a new version replaces it', async ({ createUser }) => {
  const { made, save, act, get, rows, editor, viewer } = await setup(createUser)
  await expect(save('month_close', { legal_company: '9000', close_month: '2026-10-01', version_no: 1, downloaded_at: '2026-11-10T05:00:00.000Z' }))
    .rejects.toThrow("Oct'26 already has version 1 for this company: make a new version from it")
  await expect(act(viewer, 'publish_close', { close: made.close.row_id })).rejects.toMatchObject({ status: 403 })
  await act(editor, 'publish_close', { close: made.close.row_id })
  expect(await get('month_close', made.close.row_id)).toMatchObject({ close_state: 'Published', published_by: editor.user })
  await expect(save('close_adjustment', { month_close: made.close.row_id, plant: '9003', gl_account: '49990001', amount: 5, adjustment_type: 'Provision', reason: 'Late' }))
    .rejects.toThrow("Oct'26 version 1 is published: make a new version to add or change its adjustments")
  const line = await get('close_adjustment', made.adjustment.row_id)
  await expect(save('close_adjustment', { row_id: line.row_id, updated_at: line.updated_at, amount: 1 })).rejects.toThrow("Oct'26 version 1 is published")
  // Matching to SAP is what happens after a close is published, so it stays open to that.
  await act(editor, 'match_adjustment', { adjustment: line.row_id, document: '1900019201', amount: 42500 })
  const { close } = await act<{ close: string }>(editor, 'new_close_version', { close: made.close.row_id, downloaded_at: '2026-11-12T06:30:00.000Z' })
  expect(await get('month_close', close)).toMatchObject({ version_no: 2, close_state: 'Open', legal_company: '9000' })
  expect((await get('month_close', made.close.row_id)).close_state).toBe('Replaced')
  expect((await rows('close_adjustment', [['month_close', '=', made.close.row_id]])).length).toBe(1)
  await expect(act(editor, 'new_close_version', { close: made.close.row_id, downloaded_at: '2026-11-13T06:30:00.000Z' })).rejects.toThrow("Make a new version from the latest one, version 2")
})

test('several accounts get a P&L line or a store rule together', async ({ createUser }) => {
  const { made, save, act, rows, editor, viewer } = await setup(createUser)
  await save('gl_account', { account_code: '49990002', account_name: 'Staff Uniform', statement: 'P&L' })
  await expect(act(viewer, 'set_accounts', { accounts: ['49990002'], change: { store_rule: 'Plant' } })).rejects.toMatchObject({ status: 403 })
  expect(await act(editor, 'set_accounts', { accounts: ['49990001', '49990002'], change: { pl_line: made.salaries.row_id, store_rule: 'Plant' } })).toEqual({ changed: 2 })
  expect((await rows('gl_account')).map(row => [row.pl_line, row.store_rule])).toEqual([[made.salaries.row_id, 'Plant'], [made.salaries.row_id, 'Plant']])
})

test('a new area from a date ends the area before it', async ({ createUser }) => {
  const { made, act, rows, editor } = await setup(createUser)
  await act(editor, 'add_store_area', { plant: '9003', starts_on: '2026-10-15', area_sqft: 26000, note: 'Second floor opened' })
  const areas = await rows('store_area', [['plant', '=', '9003']])
  expect(areas.map(row => [String(row.starts_on).slice(0, 10), row.ends_on ? String(row.ends_on).slice(0, 10) : null, Number(row.area_sqft)])).toEqual([['2026-04-01', '2026-10-14', 24500], ['2026-10-15', null, 26000]])
  expect(areas[0].row_id).toBe(made.area.row_id)
  await expect(act(editor, 'add_store_area', { plant: '9003', starts_on: '2026-10-01', area_sqft: 1 })).rejects.toThrow('This store already has an area from 15-Oct-2026: a new one starts after it')
})

test('every change to an account is in its history, with who made it', async ({ createUser }) => {
  const { made, save, editor } = await setup(createUser)
  await save('gl_account', { row_id: made.account.row_id, updated_at: made.account.updated_at, store_rule: 'Plant' })
  const activity = JSON.stringify(await editor.get(`/api/activity/budgets.gl_account/${made.account.row_id}`))
  expect(activity).toContain('["store_rule","Cost Centre","Plant"]')
  expect(activity).toContain(editor.user)
})

test('actuals come from the warehouse through the declared dataset, and say so when it is not connected', async ({ createUser }) => {
  const { admin, viewer } = await setup(createUser)
  const read = (payload: unknown) => viewer.post<{ result: { connected: boolean; rows: Record<string, unknown>[] } }>('/api/app_reads/budgets/actuals', { payload }).then(r => r.result)
  expect(await read({ months: ['2026-10-01'] })).toEqual({ connected: false, rows: [] })
  // The instance's MotherDuck source, played by a local DuckDB file whose name is the warehouse's database.
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'budgets-')), 'gold_finance.duckdb')
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const connection = await (await DuckDBInstance.create(file)).connect()
  await connection.run(`create schema finance; create table finance.board_pl_by_line (company_code varchar, close_month date, close_version integer, plant_code varchar, line_key varchar, as_posted decimal(18,2), as_published decimal(18,2));
    insert into finance.board_pl_by_line values ('9000', '2026-10-01', 1, '9003', 'salaries', 1700000, 1742500), ('9000', '2026-09-01', 1, '9003', 'salaries', 1650000, 1650000)`)
  connection.closeSync()
  process.env.BUDGETS_TEST_DUCKDB = file
  await admin.post('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'BUDGETS_TEST_DUCKDB', access: 'read_only' })
  invalidateSources()
  expect(await read({ months: ['2026-10-01'] })).toEqual({ connected: true, rows: [{ company_code: '9000', close_month: '2026-10-01', close_version: 1, plant_code: '9003', line_key: 'salaries', as_posted: 1700000, as_published: 1742500 }] })
  await expect(read({ months: [] })).rejects.toThrow('Say which months')
})
