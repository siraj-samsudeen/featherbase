// LOCAL DEVELOPMENT ONLY. Fills a throwaway Featherbase database with a made-up company so
// every Budgets screen has something to show: the organisation tables Budgets links to (as
// the client's instance holds them, cut to what Budgets reads), the app, two people, a
// year's budget in three versions, three closes with their adjustments, the rules, and a
// local DuckDB file that plays the warehouse for actuals. No real store, person or figure.
//
// Run it against a development server that has this app on its app path, from apps/server:
//
//   DATABASE_URL=postgres://localhost/<throwaway> FEATHERBASE_API_URL=http://127.0.0.1:<port> \
//     BUDGETS_DEV_DUCKDB=/absolute/path/gold_finance.duckdb node --import tsx ../../client-apps/jeyarama/budgets/development/seed.mts
//
// The server needs the same BUDGETS_DEV_DUCKDB to show actuals; without it the pages show
// budgets and say that actuals are not connected. Safe to run again: it stops if the app
// already holds P&L lines.
import { existsSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(appDir, '../../..')
if (!process.env.DATABASE_URL || !process.env.FEATHERBASE_API_URL) throw new Error('Set DATABASE_URL and FEATHERBASE_API_URL to the same throwaway instance')
const api = process.env.FEATHERBASE_API_URL
const server = (path: string) => import(pathToFileURL(resolve(checkout, 'apps/server/src', path)).href)
const { sql } = await server('db.ts')
const { setUserPassword } = await server('auth.ts')
const { version } = JSON.parse(await readFile(resolve(appDir, 'package.json'), 'utf8'))

const [stamp] = await sql`select value from featherbase.internal_metadata where key = 'environment'`.catch(() => [])
if (stamp?.value !== 'development') throw new Error('Refusing: this database is not stamped development')

/** The local password both made-up people sign in with (this script's own test value). */
const PASSWORD = 'budgets-dev'

type Row = Record<string, unknown> & { row_id: string; updated_at: string }
async function login(usr: string, pwd: string) {
  const response = await fetch(`${api}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usr, pwd }) })
  return (await response.json() as { token: string }).token
}
let token = await login('Administrator', 'admin')
async function call<T = Row>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${api}${path}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'X-Featherbase-App-Version': `budgets@${version}` } })
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(answer)}`)
  return answer as T
}
const save = (table: string, row: Record<string, unknown>) => call('/api/save_row', { table, row })
const own = (table: string, row: Record<string, unknown>) => save(`budgets.${table}`, row)
const act = <T = Record<string, unknown>>(name: string, payload: unknown) => call<{ result: T }>(`/api/app_actions/budgets/${name}`, { idempotencyKey: crypto.randomUUID(), payload }).then(r => r.result)
const exists = (table: string) => call(`/api/table/${encodeURIComponent(table)}?fields=["row_id"]&limit_page_length=1`).then(() => true, () => false)

// 1. The organisation's tables, made only where this database has none.
const data = (column_name: string) => ({ column_name, column_type: 'Data' })
const ref = (column_name: string, reference_table: string) => ({ column_name, column_type: 'Reference', reference_table })
const ORGANISATION = [
  { name: 'Operating Region', module: 'Organisation', id_pattern: 'field:region', title_column: 'region', columns: [data('region')] },
  { name: 'Legal Company', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name')] },
  { name: 'Site', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name'), ref('operating_region', 'Operating Region'), { column_name: 'opened_on', column_type: 'Date' }] },
  { name: 'Plant', module: 'Organisation', id_pattern: 'field:plant_code', title_column: 'plant_code', columns: [data('plant_code'), data('plant_name'), data('plant_type'), ref('site', 'Site'), ref('legal_company', 'Legal Company')] },
  { name: 'Business Line Segment', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name')] },
  { name: 'Profit Centre', module: 'Organisation', id_pattern: 'field:profit_centre', title_column: 'name', columns: [data('profit_centre'), data('name'), ref('plant', 'Plant')] },
  { name: 'Cost Centre', module: 'Organisation', id_pattern: 'field:cost_centre', title_column: 'name', columns: [data('cost_centre'), data('name'), ref('plant', 'Plant')] },
  { name: 'Subcategory', module: 'Merchandising', id_pattern: 'prompt', title_column: 'subcategory', columns: [data('subcategory')] },
]
const fresh = new Set<string>()
for (const table of ORGANISATION) if (!(await exists(table.name))) { await call('/api/table_def', table); fresh.add(table.name) }
const org = (table: string, row: Record<string, unknown>) => (fresh.has(table) ? save(table, row) : Promise.resolve())

// [plant, name, type, site, region, opened, area sq ft, monthly net sales in lakhs]
const PLACES: [string, string, string, string, string, string | null, number, number][] = [
  ['9003', 'Hilltop', 'Store', 'HIL', 'North', '2019-06-01', 24500, 410],
  ['9004', 'Lakeside', 'Store', 'LAK', 'North', '2021-11-10', 18200, 230],
  ['9005', 'Riverside', 'Store', 'RIV', 'North', '2022-03-18', 31000, 305],
  ['9006', 'Old Town', 'Store', 'OLD', 'North', '2016-01-05', 42800, 520],
  ['9007', 'Market Square', 'Store', 'MKT', 'North', '2026-08-14', 27600, 180],
  ['9100', 'Head Office North', 'Head office', 'HON', 'North', null, 0, 0],
  ['9101', 'Northgate Warehouse', 'Warehouse', 'NGW', 'North', null, 0, 0],
  ['9501', 'Harbour Road', 'Store', 'HAR', 'South', '2018-09-22', 15400, 150],
  ['9502', 'Palm Grove', 'Store', 'PLM', 'South', '2023-04-02', 12800, 120],
  ['9503', 'Seaview', 'Store', 'SEA', 'South', '2025-12-19', 16900, 95],
]
for (const region of ['North', 'South']) await org('Operating Region', { region })
await org('Legal Company', { code: '9000', name: 'Example Retail' })
for (const [plant, name, type, site, region, opened] of PLACES) {
  await org('Site', { code: site, name, operating_region: region, ...(opened ? { opened_on: opened } : {}) })
  await org('Plant', { plant_code: plant, plant_name: name, plant_type: type, site, legal_company: '9000' })
}
for (const [code, name] of [['10', 'Fashion & Lifestyle'], ['11', 'Grocery'], ['12', 'Home']]) await org('Business Line Segment', { code, name })
for (const [id, name] of [['010203001', 'Kurti'], ['010203002', 'Saree'], ['020101001', 'Rice'], ['020101002', 'Pulses'], ['030101001', 'Cookware']]) await org('Subcategory', { row_id: id, subcategory: name })

// 2. The role the organisation's tables are read through, the app, and two people.
if (!(await call('/api/table/Role/Featherbase%20Viewer').then(() => true, () => false))) await save('Role', { row_id: 'Featherbase Viewer' })
for (const table of ORGANISATION) {
  const held = await call<{ data: unknown[] }>(`/api/table/Permission?fields=["row_id"]&filters=${encodeURIComponent(JSON.stringify([['ref_table', '=', table.name], ['role', '=', 'Featherbase Viewer'], ['operation', '=', 'read']]))}`)
  if (!held.data.length) await save('Permission', { ref_table: table.name, role: 'Featherbase Viewer', operation: 'read' })
}
const [installed] = await sql`select 1 from installed_app where name = 'budgets'`
if (!installed) await call('/api/install_app', { name: 'budgets' })

async function person(email: string, full_name: string, roles: string[]) {
  const found = await call<{ data: Row[] }>(`/api/table/Person?fields=["row_id"]&filters=${encodeURIComponent(JSON.stringify([['email', '=', email]]))}`)
  const row = found.data[0] ?? await save('Person', { email, full_name, enabled: true })
  const full = await call<Row & { roles: { role: string }[] }>(`/api/table/Person/${encodeURIComponent(row.row_id)}`)
  const missing = roles.filter(role => !full.roles.some(held => held.role === role))
  if (missing.length) await save('Person', { row_id: full.row_id, updated_at: full.updated_at, roles: [...full.roles, ...missing.map(role => ({ role }))] })
  await setUserPassword(row.row_id, PASSWORD)
  return row.row_id
}
const editor = await person('asha.verma@example.test', 'Asha Verma', ['Budget Editor', 'Featherbase Viewer'])
await person('dev.malhotra@example.test', 'Dev Malhotra', ['Budget Viewer', 'Featherbase Viewer'])
// Everything below is written as the Budget Editor: the app's tables refuse anyone else, a System Manager included.
token = await login('asha.verma@example.test', PASSWORD)
if ((await call<{ data: unknown[] }>('/api/table/budgets.pl_line?fields=["row_id"]&limit_page_length=1')).data.length) {
  console.log('Budgets already holds P&L lines: nothing added.')
  process.exit(0)
}

// 3. The P&L's lines. [key, name, kind, sign, section, share of net sales, working lines]
type Share = number
const P = 'Posted', A = 'Allocated', S = 'Standing Charge'
const LINES: [string, string, string, 'Income' | 'Cost', string, Share, [string, string, 'Income' | 'Cost', Share][]?][] = [
  ['gross_sales', 'Gross Sales', 'Memo', 'Income', 'Sales', 1.12],
  ['net_sales', 'Net Sales', 'Memo', 'Income', 'Sales', 1],
  ['other_income', 'Other Income', P, 'Income', 'Sales', 0.012, [['rental_income', 'Rental Income', 'Income', 0.007], ['display_income', 'Display Income', 'Income', 0.005]]],
  ['scan_margin', 'Scan Margin', P, 'Income', 'Margin', 0.25, [['sales', 'Sales', 'Income', 1], ['cost_of_purchase', 'Cost Of Purchase', 'Cost', 0.75]]],
  ['freight_charges', 'Freight Charges', P, 'Cost', 'Margin', 0.008],
  ['packing_charges', 'Packing Charges', P, 'Cost', 'Margin', 0.003],
  ['dump', 'Dump', P, 'Cost', 'Margin', 0.004],
  ['damages', 'Damages', P, 'Cost', 'Margin', 0.002],
  ['gross_margin', 'Gross Margin', 'Subtotal', 'Income', 'Margin', 0],
  ['shrinkage', 'Shrinkage', P, 'Cost', 'Margin', 0.005],
  ['net_margin', 'Net Margin', 'Subtotal', 'Income', 'Margin', 0],
  ['manpower_cost', 'Manpower Cost', P, 'Cost', 'Store Opex', 0.062, [['salaries', 'Salaries', 'Cost', 0.048], ['pf', 'PF', 'Cost', 0.005], ['esi', 'ESI', 'Cost', 0.002], ['bonus_incentive', 'Bonus And Incentive', 'Cost', 0.004], ['staff_welfare', 'Staff Welfare', 'Cost', 0.003]]],
  ['occupancy', 'Occupancy', P, 'Cost', 'Store Opex', 0.031, [['rent', 'Rent', 'Cost', 0.031]]],
  ['customer_packing', 'Customer Packing Expenses', P, 'Cost', 'Store Opex', 0.004],
  ['electricity_fuel', 'Electricity And Fuel', P, 'Cost', 'Store Opex', 0.018, [['electricity', 'Electricity', 'Cost', 0.016], ['generator_diesel', 'Diesel For Generator', 'Cost', 0.002]]],
  ['security_housekeeping', 'Security And Housekeeping', P, 'Cost', 'Store Opex', 0.011, [['security', 'Security Costs', 'Cost', 0.006], ['housekeeping', 'Housekeeping Charges', 'Cost', 0.005]]],
  ['repairs_maintenance', 'Repairs And Maintenance', P, 'Cost', 'Store Opex', 0.007, [['repairs', 'Repairs', 'Cost', 0.005], ['software_maintenance', 'Software Maintenance', 'Cost', 0.002]]],
  ['marketing', 'Marketing', A, 'Cost', 'Store Opex', 0.012],
  ['other_store_admin', 'Other Store Admin Cost', P, 'Cost', 'Store Opex', 0.009, [['rates_taxes', 'Rates And Taxes', 'Cost', 0.002], ['professional_fees', 'Professional And Consulting Charges', 'Cost', 0.002], ['travel', 'Travel And Conveyance', 'Cost', 0.001], ['printing_stationery', 'Printing And Stationery', 'Cost', 0.001], ['insurance', 'Insurance', 'Cost', 0.001], ['communication', 'Communication', 'Cost', 0.001], ['card_charges', 'Card Charges', 'Cost', 0.001]]],
  ['notional_rent', 'Notional Rent', S, 'Cost', 'Store Opex', 0],
  ['charge_to_colocated', 'Charge To Co-located Business', S, 'Income', 'Store Opex', 0],
  ['warehouse_cost', 'Warehouse Cost - Allocated', A, 'Cost', 'Store Opex', 0.006],
  ['interest_on_inventory', 'Interest On Inventory', A, 'Cost', 'Store Opex', 0.004],
  ['total_store_opex', 'Total Store Opex', 'Subtotal', 'Cost', 'Store Opex', 0],
  ['store_ebitda', 'Store EBITDA', 'Subtotal', 'Income', 'Below Store EBITDA', 0],
  ['head_office_cost', 'Head Office Cost - Allocated', A, 'Cost', 'Below Store EBITDA', 0.02],
  ['ebitda', 'EBITDA', 'Subtotal', 'Income', 'Below EBITDA', 0],
  ['depreciation', 'Depreciation', P, 'Cost', 'Below EBITDA', 0.012],
  ['interest', 'Interest', P, 'Cost', 'Below EBITDA', 0.006],
  ['pbt', 'PBT', 'Subtotal', 'Income', 'Below EBITDA', 0],
]
let order = 0
for (const [line_key, line_name, line_kind, sign, section, , working] of LINES) {
  order += 100
  await own('pl_line', { line_key, line_name, level: 'Published', line_order: order, section, line_kind, sign, ...(line_kind === 'Subtotal' ? { subtotal_rule: line_key === 'total_store_opex' ? 'Section Total' : 'Running Total' } : {}), shows_per_sqft_day: section === 'Store Opex' })
  for (const [index, [key, name, workingSign]] of (working ?? []).entries())
    await own('pl_line', { line_key: key, line_name: name, level: 'Working', rolls_into: line_key, line_order: order + index + 1, section, line_kind: 'Posted', sign: workingSign })
}

// 4. Accounts: one or two for each working line, three not classified yet.
const working = LINES.flatMap(([, , , , , , lines]) => lines ?? [])
let accountNo = 40000100
const accountOf = new Map<string, string>()
for (const [key, name, sign] of working) {
  for (const suffix of sign === 'Cost' && ['salaries', 'electricity', 'repairs'].includes(key) ? ['', ' - Arrears'] : ['']) {
    const account_code = String(accountNo += 7)
    await own('gl_account', { account_code, account_name: `${name}${suffix}`, statement: 'P&L', pl_line: key, store_rule: key === 'sales' || key === 'cost_of_purchase' ? 'Plant' : key.endsWith('_income') ? 'Profit Centre' : 'Cost Centre', falls_back_to_cost_centre: key === 'sales' })
    if (!suffix) accountOf.set(key, account_code)
  }
}
for (const name of ['Drinking Water', 'Pallet Purchases', 'Festival Decoration']) await own('gl_account', { account_code: String(accountNo += 7), account_name: name, statement: 'P&L' })
for (const name of ['Salary Payable', 'Capital Work In Progress']) await own('gl_account', { account_code: String(accountNo += 7), account_name: name, statement: 'Balance Sheet' })
await own('gl_account_split', { gl_account: accountOf.get('staff_welfare'), plant: '9004', pl_line: 'electricity', share_percent: 70, starts_on: '2026-04-01' })
await own('gl_account_split', { gl_account: accountOf.get('staff_welfare'), plant: '9004', pl_line: 'staff_welfare', share_percent: 30, starts_on: '2026-04-01' })

// 5. Store areas, one store with a floor added mid-year.
for (const [plant, , type, , , , area] of PLACES) {
  if (type !== 'Store') continue
  if (plant === '9003') {
    await act('add_store_area', { plant, starts_on: '2019-06-01', area_sqft: 21000, note: 'Lease plan' })
    await act('add_store_area', { plant, starts_on: '2026-07-01', area_sqft: area, note: 'Second floor opened' })
  } else await act('add_store_area', { plant, starts_on: '2016-01-01', area_sqft: area, note: 'Lease plan' })
}

// 6. Allocation rules and standing charges.
const rule = (row: Record<string, unknown>) => own('allocation_rule', { starts_on: '2026-04-01', ...row })
const warehouse = await rule({ rule_name: 'Northgate Warehouse Cost', rule_kind: 'Allocate A Cost Pool', run_order: 10, source_plant: '9101', target_line: 'warehouse_cost', basis: 'Net Sales Of Named Segments', operating_region: 'North' })
for (const segment of ['10', '12']) await own('allocation_rule_segment', { allocation_rule: warehouse.row_id, business_line_segment: segment })
await own('allocation_rule_store', { allocation_rule: warehouse.row_id, plant: '9007', treatment: 'Excluded' })
await rule({ rule_name: 'Marketing', rule_kind: 'Allocate A Cost Pool', run_order: 20, source_line: 'marketing', target_line: 'marketing', basis: 'Net Sales', operating_region: 'North' })
await rule({ rule_name: 'Head Office Cost', rule_kind: 'Allocate A Cost Pool', run_order: 30, source_plant: '9100', target_line: 'head_office_cost', basis: 'Store Area', operating_region: 'North' })
await rule({ rule_name: 'Interest On Inventory', rule_kind: 'Allocate A Cost Pool', run_order: 40, source_line: 'interest', target_line: 'interest_on_inventory', basis: 'Inventory', operating_region: 'North' })
const rent = await rule({ rule_name: 'Notional Rent On Owned Stores', rule_kind: 'Standing Charge', run_order: 50, target_line: 'notional_rent', basis: 'Rate Per Sq Ft', rate_per_sqft: 40, note: 'The company owns these two buildings and pays no rent, so the P&L carries a notional one.' })
for (const plant of ['9005', '9006']) await own('allocation_rule_store', { allocation_rule: rent.row_id, plant, treatment: 'Included' })
const colocated = await rule({ rule_name: 'Charge To Co-located Business', rule_kind: 'Standing Charge', run_order: 60, target_line: 'charge_to_colocated', basis: 'Rate Per Sq Ft', rate_per_sqft: 100, note: 'Rent and common area upkeep for the space another business of the group occupies.' })
await own('allocation_rule_store', { allocation_rule: colocated.row_id, plant: '9006', treatment: 'Included', area_sqft: 5200 })

// 7. Budgets. Figures follow each store's monthly sales, a season, and each line's share.
const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].map(m => `${m}-01`)
const SEASON = [0.92, 0.95, 0.9, 0.96, 1.04, 1.02, 1.18, 1.22, 1.08, 1.1, 0.94, 0.97]
/** A steady, repeatable wobble between -1 and 1 for a store, line and month. */
const wobble = (seed: string) => { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 2001) / 1000 - 1 }
const round = (lakhs: number) => Math.round(lakhs * 100) * 1000
const stores = (region: string) => PLACES.filter(([, , type, , r]) => type === 'Store' && r === region)
function budgetValues(region: string, months: string[], lift = 1) {
  const values: { plant: string; pl_line: string; budget_month: string; amount: number }[] = []
  for (const [plant, , , , , opened, , sales] of stores(region)) for (const month of months) {
    if (opened && opened.slice(0, 7) > month.slice(0, 7)) continue
    const net = sales * SEASON[MONTHS.indexOf(month)] * lift
    for (const [line, , kind, , , share] of LINES) {
      if (kind === 'Subtotal' || !share) continue
      values.push({ plant, pl_line: line, budget_month: month, amount: round(net * share * (1 + 0.03 * wobble(`${plant}${line}`))) })
    }
    if (['9005', '9006'].includes(plant)) values.push({ plant, pl_line: 'notional_rent', budget_month: month, amount: (plant === '9005' ? 31000 : 42800) * 40 })
    if (plant === '9006') values.push({ plant, pl_line: 'charge_to_colocated', budget_month: month, amount: 520000 })
  }
  return values
}
/** One store at a time: each figure is saved under the app's rules, so a year for every store in one request is slow. */
async function paste(version: string, values: ReturnType<typeof budgetValues>) {
  for (const plant of new Set(values.map(value => value.plant))) await act('paste_budget', { version, values: values.filter(value => value.plant === plant) })
}
const versionRow = (row: Record<string, unknown>) => own('budget_version', { budget_kind: 'P&L', fiscal_year: 'FY27', covers_from: MONTHS[0], covers_to: MONTHS[11], ...row })
const original = await versionRow({ version_name: 'FY27 Original', operating_region: 'North', source_file: 'North Budget FY27 v3.xlsx' })
await paste(original.row_id, budgetValues('North', MONTHS))
await act('approve_version', { version: original.row_id })
const { version: revised } = await act<{ version: string }>('revise_version', { version: original.row_id, version_name: 'FY27 Revision 1', covers_from: MONTHS[6], covers_to: MONTHS[11] })
await paste(revised, budgetValues('North', MONTHS.slice(6), 1.04).filter(v => ['gross_sales', 'net_sales', 'scan_margin', 'manpower_cost', 'marketing'].includes(v.pl_line)))
await act('approve_version', { version: revised })
await act('revise_version', { version: revised, version_name: 'FY27 Revision 2', covers_from: MONTHS[9], covers_to: MONTHS[11] })
const south = await versionRow({ version_name: 'FY27 South Original', operating_region: 'South', source_file: 'South P&L Projection FY27.xlsx' })
await paste(south.row_id, budgetValues('South', MONTHS))
await act('approve_version', { version: south.row_id })
await own('budget_store_plan', { budget_version: original.row_id, plant: '9007', planned_opening_on: '2026-08-01', planned_area_sqft: 27600, note: 'Opened two weeks later than planned.' })
const sales = await versionRow({ version_name: 'FY27 Sales Original', budget_kind: 'Sales', source_file: 'Sales Budget FY27.xlsx' })
for (const month of MONTHS) for (const [subcategory, base] of [['010203001', 31], ['010203002', 44], ['020101001', 58], ['020101002', 22], ['030101001', 17]] as const)
  await own('sales_budget', { budget_version: sales.row_id, plant: '9003', budget_month: month, subcategory, budget_quantity: Math.round(base * 40 * SEASON[MONTHS.indexOf(month)]), budget_value: round(base * SEASON[MONTHS.indexOf(month)]) })

// 8. Closes and their manual lines.
const close = (row: Record<string, unknown>) => own('month_close', { legal_company: '9000', version_no: 1, ...row })
const north = stores('North').map(([plant]) => plant)
const september = await close({ close_month: '2026-09-01', downloaded_at: '2026-10-08T12:40:00.000Z' })
await act('paste_adjustments', { close: september.row_id, values: north.slice(0, 4).map(plant => ({ plant, gl_account: accountOf.get('electricity'), amount: 180000 + 20000 * wobble(plant), adjustment_type: 'Provision', reason: 'Provision for September electricity bills not received' })) })
await act('publish_close', { close: september.row_id })
const october = await close({ close_month: '2026-10-01', downloaded_at: '2026-11-09T13:05:00.000Z' })
const pasted = (reason: string, type: string, account: string, amounts: (plant: string) => number, plants = north) =>
  act('paste_adjustments', { close: october.row_id, values: plants.map(plant => ({ plant, gl_account: accountOf.get(account), amount: Math.round(amounts(plant)), adjustment_type: type, reason })) })
await pasted('Reversal of the provision taken in September', 'Provision', 'electricity', plant => -(180000 + 20000 * wobble(plant)), north.slice(0, 4))
await pasted('Provision for October salary arrears, from the pay register', 'Provision', 'salaries', plant => 240000 + 60000 * wobble(plant))
await pasted('Provision for October PF and ESI', 'Provision', 'pf', plant => 52000 + 9000 * wobble(plant))
await pasted('Provision for October electricity bills not received', 'Provision', 'electricity', plant => 195000 + 25000 * wobble(`${plant}oct`))
await pasted('Rates and taxes booked in head office, moved to the stores', 'Reallocation', 'rates_taxes', plant => 38000 + 6000 * wobble(plant))
await act('paste_adjustments', { close: october.row_id, values: [
  { plant: '9100', gl_account: accountOf.get('rates_taxes'), amount: -north.reduce((sum, plant) => sum + Math.round(38000 + 6000 * wobble(plant)), 0), adjustment_type: 'Reallocation', reason: 'Rates and taxes booked in head office, moved to the stores' },
  { plant: '9101', gl_account: accountOf.get('repairs'), amount: -412000, adjustment_type: 'Capitalise', reason: 'Pallet racking bought in October, to be capitalised' },
  { plant: '9005', gl_account: accountOf.get('repairs'), amount: -96000, adjustment_type: 'Recover', reason: 'Lift repair within warranty, to be recovered from the supplier' },
  { plant: '9006', gl_account: accountOf.get('insurance'), amount: -150000, adjustment_type: 'Defer', reason: 'Annual insurance premium paid in October, spread over the year' },
] })
await act('publish_close', { close: october.row_id })
const { data: octoberLines } = await call<{ data: Row[] }>(`/api/table/budgets.close_adjustment?fields=["row_id","amount","reason","plant"]&limit_page_length=200&filters=${encodeURIComponent(JSON.stringify([['month_close', '=', october.row_id]]))}`)
for (const line of octoberLines.filter(l => String(l.reason).includes('salary arrears')).slice(0, 3)) await act('match_adjustment', { adjustment: line.row_id, document: `19000${Math.abs(Math.round(Number(line.amount))) % 100000}`, amount: Number(line.amount) })
const half = octoberLines.find(l => String(l.reason).includes('electricity bills') && l.plant === '9003')
if (half) await act('match_adjustment', { adjustment: half.row_id, document: '1900041207', amount: Math.round(Number(half.amount) * 0.6) })
await act('set_adjustments', { adjustments: octoberLines.filter(l => String(l.reason).includes('Reversal')).map(l => l.row_id), change: { adjustment_state: 'Released' } })
const { close: octoberV2 } = await act<{ close: string }>('new_close_version', { close: october.row_id, downloaded_at: '2026-11-12T06:30:00.000Z' })
await act('paste_adjustments', { close: octoberV2, values: [{ plant: '9004', gl_account: accountOf.get('professional_fees'), amount: 85000, adjustment_type: 'Provision', reason: 'Audit fee for the half year, agreed after the first publication' }] })
await act('publish_close', { close: octoberV2 })
const november = await close({ close_month: '2026-11-01', downloaded_at: '2026-12-08T11:20:00.000Z' })
await act('paste_adjustments', { close: november.row_id, values: north.map(plant => ({ plant, gl_account: accountOf.get('salaries'), amount: Math.round(210000 + 50000 * wobble(`${plant}nov`)), adjustment_type: 'Provision', reason: 'Provision for November salary arrears, from the pay register' })) })

// 9. The warehouse, played by a local DuckDB file: actuals by working line for the months closed so far.
const file = process.env.BUDGETS_DEV_DUCKDB
if (file) {
  if (!file.endsWith('/gold_finance.duckdb')) throw new Error('BUDGETS_DEV_DUCKDB must be a file called gold_finance.duckdb: the dataset reads gold_finance.finance.board_pl_by_line')
  if (existsSync(file)) rmSync(file)
  const { DuckDBInstance } = await import(pathToFileURL(resolve(checkout, 'apps/server/node_modules/@duckdb/node-api/lib/index.js')).href)
  const connection = await (await DuckDBInstance.create(file)).connect()
  await connection.run('create schema finance; create table finance.board_pl_by_line (company_code varchar, close_month date, close_version integer, plant_code varchar, line_key varchar, as_posted decimal(18,2), as_published decimal(18,2))')
  const rows: string[] = []
  const closed: [string, number[]][] = [['2026-04-01', [1]], ['2026-05-01', [1]], ['2026-06-01', [1]], ['2026-07-01', [1]], ['2026-08-01', [1]], ['2026-09-01', [1]], ['2026-10-01', [1, 2]]]
  for (const [month, versions] of closed) for (const closeVersion of versions) for (const region of ['North', 'South']) for (const [plant, , , , , opened, , salesBase] of stores(region)) {
    if (opened && opened.slice(0, 7) > month.slice(0, 7)) continue
    const net = salesBase * SEASON[MONTHS.indexOf(month)] * (1 + 0.06 * wobble(`${plant}${month}actual`))
    const put = (line: string, share: number, drift = 0.08) => {
      const posted = round(net * share * (1 + drift * wobble(`${plant}${line}${month}`)))
      const published = round(posted / 100000 * (line === 'salaries' || line === 'electricity' ? 1.03 + 0.005 * closeVersion : 1))
      rows.push(`('9000', '${month}', ${closeVersion}, '${plant}', '${line}', ${posted}, ${published})`)
    }
    for (const [line, , kind, , , share, lines] of LINES) {
      if (kind === 'Subtotal' || !share) continue
      if (lines) for (const [key, , , workingShare] of lines) put(key, workingShare, key === 'sales' ? 0 : 0.08)
      else put(line, share)
    }
  }
  await connection.run(`insert into finance.board_pl_by_line values ${rows.join(',')}`)
  connection.closeSync()
  token = await login('Administrator', 'admin')
  if (!(await call('/api/table/Data%20Source/motherduck').then(() => true, () => false))) await call('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'BUDGETS_DEV_DUCKDB', access: 'read_only' })
}

console.log(`Budgets is filled with made-up data.
Sign in as asha.verma@example.test (Budget Editor) or dev.malhotra@example.test (Budget Viewer), password ${PASSWORD}.
${file ? `Actuals come from ${file}.` : 'No BUDGETS_DEV_DUCKDB was given, so the pages will say that actuals are not connected.'}`)
process.exit(0)
