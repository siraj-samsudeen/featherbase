// The made-up world the Budgets tests share: the instance's own tables the app links to
// (Plant and the rest, as production holds them, cut to what Budgets reads), the app
// installed, and one row in each Budgets table. Every name and figure is invented.
import { resolve } from 'node:path'
import { expect } from 'vitest'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import manifest from '../../../client-apps/jeyarama/budgets/featherbase.json'
import { version } from '../../../client-apps/jeyarama/budgets/package.json'
import { installApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { grantRole } from './fixtures'

// A client built with the Budgets app, as the Assets tests model theirs.
export function budgetsClient(client: TestClient): TestClient {
  return makeClient({ request: (path, init) => client.fetch(String(path), {
    ...init,
    headers: { 'X-Featherbase-App-Version': `budgets@${version}`, ...init?.headers },
  }) }, client.token, client.user)
}

/** As the real instance has it: the organisation's tables are read through an instance role, which Budgets people hold beside their Budgets role. */
export const EDITOR = ['Budget Editor', 'Featherbase Viewer']
export const VIEWER = ['Budget Viewer', 'Featherbase Viewer']

export type Row = { row_id: string; updated_at: string; [field: string]: unknown }

const data = (column_name: string) => ({ column_name, column_type: 'Data' })
const ref = (column_name: string, reference_table: string) => ({ column_name, column_type: 'Reference', reference_table })

export const INSTANCE_TABLES = [
  { name: 'Operating Region', module: 'Organisation', id_pattern: 'field:region', title_column: 'region', columns: [data('region')] },
  { name: 'Legal Company', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name')] },
  { name: 'Site', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name'), ref('operating_region', 'Operating Region'), { column_name: 'opened_on', column_type: 'Date' }] },
  { name: 'Plant', module: 'Organisation', id_pattern: 'field:plant_code', title_column: 'plant_code', columns: [data('plant_code'), data('plant_name'), data('plant_type'), ref('site', 'Site'), ref('legal_company', 'Legal Company')] },
  { name: 'Business Line Segment', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name')] },
  { name: 'Profit Centre', module: 'Organisation', id_pattern: 'field:profit_centre', title_column: 'name', columns: [data('profit_centre'), data('name'), ref('plant', 'Plant')] },
  { name: 'Cost Centre', module: 'Organisation', id_pattern: 'field:cost_centre', title_column: 'name', columns: [data('cost_centre'), data('name'), ref('plant', 'Plant')] },
  { name: 'Subcategory', module: 'Merchandising', id_pattern: 'prompt', title_column: 'subcategory', columns: [data('subcategory')] },
]

const INSTANCE_ROWS: [string, Record<string, unknown>][] = [
  ['Operating Region', { region: 'North' }],
  ['Legal Company', { code: '9000', name: 'Example Retail' }],
  ['Site', { code: 'HIL', name: 'Hilltop', operating_region: 'North', opened_on: '2021-06-01' }],
  ['Site', { code: 'LAK', name: 'Lakeside', operating_region: 'North', opened_on: '2025-11-10' }],
  ['Site', { code: 'NGW', name: 'Northgate Warehouse', operating_region: 'North' }],
  ['Plant', { plant_code: '9003', plant_name: 'Hilltop', plant_type: 'Store', site: 'HIL', legal_company: '9000' }],
  ['Plant', { plant_code: '9004', plant_name: 'Lakeside', plant_type: 'Store', site: 'LAK', legal_company: '9000' }],
  ['Plant', { plant_code: '9101', plant_name: 'Northgate Warehouse', plant_type: 'Warehouse', site: 'NGW', legal_company: '9000' }],
  ['Business Line Segment', { code: '10', name: 'Fashion & Lifestyle' }],
  ['Profit Centre', { profit_centre: 'PC-9003-10', name: 'Hilltop Retail', plant: '9003' }],
  ['Cost Centre', { cost_centre: 'CC-9003-1001', name: 'Hilltop Retail · Operations', plant: '9003' }],
  ['Subcategory', { row_id: '010203001', subcategory: 'Kurti' }],
]

/** The instance's tables with a few rows, then the Budgets app. `admin` is a System Manager. */
export async function installBudgets(admin: TestClient) {
  for (const table of INSTANCE_TABLES) await admin.post('/api/table_def', table)
  for (const [table, row] of INSTANCE_ROWS) await admin.post('/api/save_row', { table, row })
  await grantRole(admin, { role: 'Featherbase Viewer', table: INSTANCE_TABLES.map(table => table.name), can_read: true })
  expect(await discoverPackages([resolve('../..', 'client-apps/jeyarama/budgets')])).toEqual([])
  await installApp('budgets')
}

/** One row in every Budgets table, saved by a Budget Editor. */
export async function world(editor: TestClient) {
  const save = (table: string, row: Record<string, unknown>) => editor.post<Row>('/api/save_row', { table: `budgets.${table}`, row })
  const manpower = await save('pl_line', { line_key: 'manpower_cost', line_name: 'Manpower Cost', level: 'Published', line_order: 400, section: 'Store Opex', line_kind: 'Posted', sign: 'Cost' })
  const salaries = await save('pl_line', { line_key: 'salaries', line_name: 'Salaries', level: 'Working', rolls_into: manpower.row_id, line_order: 410, section: 'Store Opex', line_kind: 'Posted', sign: 'Cost' })
  const warehouse = await save('pl_line', { line_key: 'warehouse_cost', line_name: 'Warehouse Cost - Allocated', level: 'Published', line_order: 600, section: 'Store Opex', line_kind: 'Allocated', sign: 'Cost' })
  const account = await save('gl_account', { account_code: '49990001', account_name: 'Staff Tea And Snacks', statement: 'P&L', pl_line: salaries.row_id, store_rule: 'Cost Centre' })
  const split = await save('gl_account_split', { gl_account: account.row_id, plant: '9004', pl_line: salaries.row_id, share_percent: 100, starts_on: '2026-04-01' })
  const rule = await save('allocation_rule', { rule_name: 'Northgate Warehouse Cost', rule_kind: 'Allocate A Cost Pool', run_order: 20, source_plant: '9101', target_line: warehouse.row_id, basis: 'Net Sales Of Named Segments', operating_region: 'North', starts_on: '2026-04-01' })
  await save('allocation_rule_segment', { allocation_rule: rule.row_id, business_line_segment: '10' })
  await save('allocation_rule_store', { allocation_rule: rule.row_id, plant: '9004', treatment: 'Excluded' })
  const area = await save('store_area', { plant: '9003', starts_on: '2026-04-01', area_sqft: 24500 })
  const version = await save('budget_version', { version_name: 'FY27 Original', budget_kind: 'P&L', fiscal_year: 'FY27', operating_region: 'North', covers_from: '2026-04-01', covers_to: '2027-03-01' })
  const budget = await save('pl_budget', { budget_version: version.row_id, plant: '9003', budget_month: '2026-10-01', pl_line: manpower.row_id, amount: 1840000 })
  await save('budget_store_plan', { budget_version: version.row_id, plant: '9004', planned_opening_on: '2027-01-15', planned_area_sqft: 31000 })
  const sales = await save('budget_version', { version_name: 'FY27 Sales Original', budget_kind: 'Sales', fiscal_year: 'FY27', covers_from: '2026-04-01', covers_to: '2027-03-01' })
  await save('sales_budget', { budget_version: sales.row_id, plant: '9003', budget_month: '2026-10-01', subcategory: '010203001', budget_quantity: 420, budget_value: 315000 })
  const close = await save('monthly_close', { legal_company: '9000', close_month: '2026-10-01', version_no: 1, downloaded_at: '2026-11-09T13:05:44.000Z' })
  const adjustment = await save('monthly_close_adjustment', { monthly_close: close.row_id, plant: '9003', gl_account: account.row_id, amount: 42500, adjustment_type: 'Provision', reason: 'Provision for October electricity bill not received' })
  return { manpower, salaries, warehouse, account, split, rule, area, version, budget, sales, close, adjustment }
}

export type Create = (options: { roles: string[] }) => Promise<TestClient>
/** The app installed, an editor and a viewer, the made-up world, and the calls the tests make. */
export async function setup(createUser: Create) {
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
