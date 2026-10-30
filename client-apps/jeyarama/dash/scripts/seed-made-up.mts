// LOCAL DEVELOPMENT ONLY. Fills a throwaway featherbase database, served by a
// featherbase checkout's dev server with this app on its app path, with
// made-up stores, people, an org chart and a cached copy of the report's
// dataset, so every state of the report page can be seen without MotherDuck.
// No real store, person, code or figure.
//
// Run with the checkout's own tsx, from its apps/server folder (README,
// "Seeing the report locally"):
//
//   cd apps/server && FEATHER_DASH_API=http://localhost:8000 DATABASE_URL=postgres://…/feather_dash_dev \
//     node_modules/.bin/tsx ../../client-apps/jeyarama/dash/scripts/seed-made-up.mts ../.. ../../client-apps/jeyarama/dash
//
// It refuses a database that is not stamped `development`. It installs the app
// when it isn't installed. Run it once per database.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const [checkout, appDir] = process.argv.slice(2)
if (!checkout || !appDir) throw new Error('usage: seed-made-up.mts <featherbase checkout> <app folder>')
// Both are required: without DATABASE_URL the checkout's db.ts falls back to the default local
// database while the API calls reach another, and the seed lands in the wrong one (#4453).
if (!process.env.DATABASE_URL || !process.env.FEATHER_DASH_API)
  throw new Error('Set DATABASE_URL and FEATHER_DASH_API to the same throwaway instance (README, "Seeing the report locally")')
const api = process.env.FEATHER_DASH_API
const server = (path: string) => import(pathToFileURL(resolve(checkout, 'apps/server/src', path)).href)
const { sql } = await server('db.ts')
const { setUserPassword } = await server('auth.ts')
const { applySeedPack } = await server('seed-packs.ts')
const { datasetsDeclaration } = await server('app-datasets.ts')
const { markScopeTables } = await import(pathToFileURL(resolve(appDir, 'platform-test/mark-scope-tables.mjs')).href)

/** The local password every made-up reader signs in with (this script's own test value). */
const PASSWORD = 'feather-dash-dev'

const [stamp] = await sql`select value from featherbase.internal_metadata where key = 'environment'`.catch(() => [])
if (stamp?.value !== 'development') throw new Error('Refusing: this database is not stamped development')

const login = await (await fetch(`${api}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ usr: 'Administrator', pwd: 'admin' }) })).json() as { token: string }
async function call<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, { ...init, headers: { authorization: `Bearer ${login.token}`, 'content-type': 'application/json',
    'X-Featherbase-App-Version': `feather_dash@${JSON.parse(await readFile(resolve(appDir, 'package.json'), 'utf8')).version}`, ...init.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`)
  return body as T
}
const post = (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body) })
const save = (table: string, row: Record<string, unknown>) => post('/api/save_row', { table, row }) as Promise<{ row_id: string }>

// The employee-code identifier system the scope provider declares.
await applySeedPack('jeyarama')

const [installed] = await sql`select 1 from installed_app where name = 'feather_dash'`
if (!installed) await post('/api/install_app', { name: 'feather_dash' })

// Until every store is live the provider reads the old Store Sections Tables, so they exist, marked.
const OLD = [
  ['Sales Target Assignment', [{ column_name: 'employee', column_type: 'Reference', reference_table: 'Person', reqd: true },
    { column_name: 'plant_code', column_type: 'Data', reqd: true }, { column_name: 'store_label', column_type: 'Data' },
    { column_name: 'material_group', column_type: 'Data', reqd: true }]],
  ['Employee Section Map', ['store_code', 'employee_code', 'subcategory', 'section_name']],
  ['Section Ownership', ['store_code', 'section_name', 'tl_employee_code', 'dm_employee_code', 'effective_from']],
  ['Store Manager', ['store_code', 'employee_code', 'full_name', 'email']],
  ['Section Merchandise Map', ['store_code', 'material_group', 'mch_subcategory', 'section_name']],
  ['Section Name Alias', ['store_code', 'merch_section_name', 'roster_section_name']],
] as const
for (const [name, columns] of OLD) {
  const exists = await call(`/api/table/${encodeURIComponent(name)}:meta`).then(() => true, () => false)
  if (!exists) await post('/api/table_def', { name, module: 'Store Sections',
    columns: columns.map(c => typeof c === 'string' ? { column_name: c, column_type: 'Data' } : c) })
}
await markScopeTables((path: string, init?: RequestInit) => call(path, init))

// The instance's MotherDuck source, played by a local DuckDB path that nothing opens: the
// platform serves the cached copy below without querying it.
const sourceExists = await call('/api/table/Data%20Source/motherduck').then(() => true, () => false)
if (!sourceExists) await post('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'FEATHER_DASH_LOCAL_DUCKDB', access: 'read_only' })

// Made-up people, each a Feather Dash Reader.
const people: Record<string, string> = {}
for (const [key, name] of [['many', 'Asha Many-Stores'], ['one', 'Ravi One-Store'], ['none', 'Nila No-Access'], ['bare', 'Kumar Bare-Store'],
  ['quiet', 'Meena Quiet-Section'], ['sm', 'Selvi Store-Manager'], ['tl2', 'Tara Two-Sections'], ['tl4', 'Faiz Four-Sections'],
  ['several', 'Vani Several-Roles'], ['assigned', 'Arun Assigned'], ['preparing', 'Priya Preparing'], ['dm2', 'Deepa Department-Manager'],
  ['staff1', 'Siva Section-Staff'], ['tl3', 'Tamil Three-Sections'], ['smtl', 'Mohan Manager-And-Leader'],
  ['smlarge', 'Bala Large-Store']]) {
  const email = `reader-${key}@example.test`
  const [found] = await sql`select row_id from person where lower(email) = ${email}`
  const id = found ? String(found.row_id) : String((await post('/api/table/Person', { email, full_name: name, enabled: true,
    roles: [{ role: 'Feather Dash Reader' }] })).row_id)
  await setUserPassword(id, PASSWORD)
  people[key] = id
}

// Stores: Lakeside 9901 and Hillview 9902 have sections; Riverside 9903 has none; Northgate 9905 has
// a section but nothing cached (its figures are being prepared). All live. Parkside 9904 is not live:
// it is on the old rules, where a subcategory can be assigned to a person (#4486).
for (const store of ['9901', '9902', '9903', '9905', '9906']) await save('feather_dash.store_rollout', { store, live_since: '2026-01-01' }).catch(() => {})
const section = (store: string, name: string) => save('feather_dash.section', { store, section_name: name })
const place = (store: string, subcategory: string, sectionId: string) =>
  save('feather_dash.section_subcategory', { store, subcategory, section: sectionId, starts_on: '2026-01-01' })
const sarees = await section('9901', 'Sarees')
const kids = await section('9901', 'Kids Wear')
const bags = await section('9901', 'Bags')
const belts = await section('9902', 'Accessories')
await place('9901', '010101001', sarees.row_id)
await place('9901', '010101002', sarees.row_id)
await place('9901', '010202001', kids.row_id)
// Bags sold nothing and had no target this month: its Team Leader's scoped rows are empty.
await place('9901', '010606001', bags.row_id)
await place('9902', '010404001', belts.row_id)
// #4486: enough sections at Lakeside for a Team Leader of four, and Northgate's one section.
const footwear = await section('9901', 'Footwear')
const watches = await section('9901', 'Watches')
const sports = await section('9901', 'Sportswear')
await place('9901', '010707001', footwear.row_id)
await place('9901', '010808001', watches.row_id)
await place('9901', '011010001', sports.row_id)
// A department of two sections at Lakeside, for a Department Manager.
const menswear = await save('feather_dash.department', { store: '9901', department_key: 'menswear', name: 'Menswear' })
const shirts = await save('feather_dash.section', { store: '9901', section_name: 'Formal Shirts', department: menswear.row_id })
const trousers = await save('feather_dash.section', { store: '9901', section_name: 'Trousers', department: menswear.row_id })
await place('9901', '011212001', shirts.row_id)
await place('9901', '011313001', trousers.row_id)
const toys = await section('9905', 'Toys')
await place('9905', '011111001', toys.row_id)
const job = (person: string, job: string, store: string, extra: Record<string, unknown> = {}) =>
  save('feather_dash.job_assignment', { person, job, store, starts_on: '2026-01-01', ...extra })
await job(people.many, 'Cluster Manager', '9901')
await job(people.many, 'Cluster Manager', '9902')
await job(people.one, 'Team Leader', '9901', { section: sarees.row_id })
await job(people.quiet, 'Team Leader', '9901', { section: bags.row_id })
await job(people.bare, 'Store Manager', '9903')
// #4486: one reader per reason, so the page's "why" sentence can be seen in each state.
await job(people.sm, 'Store Manager', '9901')
await job(people.tl2, 'Team Leader', '9901', { section: sarees.row_id })
await job(people.tl2, 'Team Leader', '9901', { section: kids.row_id })
for (const s of [bags, footwear, watches, sports]) await job(people.tl4, 'Team Leader', '9901', { section: s.row_id })
await job(people.several, 'Team Leader', '9901', { section: sarees.row_id })
await job(people.several, 'Staff', '9901', { section: kids.row_id })
await job(people.preparing, 'Team Leader', '9905', { section: toys.row_id })
await job(people.dm2, 'Department Manager', '9901', { department: menswear.row_id })
await job(people.staff1, 'Staff', '9901', { section: sarees.row_id })
for (const s of [bags, footwear, watches]) await job(people.tl3, 'Team Leader', '9901', { section: s.row_id })
await job(people.smtl, 'Store Manager', '9901')
await job(people.smtl, 'Team Leader', '9901', { section: sarees.row_id })
// #4453: a large store, Bayside 9906, with 1,600 made-up subcategories; two sections name a few of them.
const LARGE = Array.from({ length: 1600 }, (_, i) => `02${String(Math.floor(i / 100)).padStart(2, '0')}${String(i % 100).padStart(5, '0')}`)
const baysideHome = await section('9906', 'Home Linen')
const baysideToys = await section('9906', 'Toys')
for (const code of LARGE.slice(0, 3)) await place('9906', code, baysideHome.row_id)
for (const code of LARGE.slice(3, 6)) await place('9906', code, baysideToys.row_id)
await job(people.smlarge, 'Store Manager', '9906')
// Parkside, on the old rules: its merchandise map, and one subcategory assigned to a person with no employee code.
const oldRow = (table: string, row: Record<string, unknown>) => post(`/api/table/${encodeURIComponent(table)}`, row)
await oldRow('Section Merchandise Map', { store_code: '9904', material_group: '010101001', mch_subcategory: 'Silk sarees', section_name: 'Ethnic' })
await oldRow('Section Merchandise Map', { store_code: '9904', material_group: '010202001', mch_subcategory: 'Boys shirts', section_name: 'Kids' })
await oldRow('Sales Target Assignment', { employee: people.assigned, plant_code: '9904', store_label: 'Parkside', material_group: '010101001' })

// The cached copies, consistent with each other: refreshed at 05:49 IST on the last morning
// that has passed, with data to the day before that refresh.
const IST = 330 * 60_000
const ist = (instant: number) => new Date(instant + IST).toISOString().slice(0, 10)
const morning = (day: string) => Date.parse(`${day}T05:49:00+05:30`)
const todayIst = ist(Date.now())
const refreshed = Date.now() >= morning(todayIst) ? morning(todayIst) : morning(ist(Date.now() - 86_400_000))
const refreshedAt = new Date(refreshed).toISOString()
const dataThrough = ist(refreshed - 86_400_000)
const periodStart = `${todayIst.slice(0, 8)}01`
const lastMonth = new Date(Date.UTC(Number(todayIst.slice(0, 4)), Number(todayIst.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10)
const lastMonthEnd = new Date(Date.UTC(Number(todayIst.slice(0, 4)), Number(todayIst.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10)
// Lakeside and Parkside carry a short code, as the warehouse's store master does; the header names them by it.
const SHORT_CODES: Record<string, string> = { '9901': 'LKS', '9904': 'PKS', '9906': 'BYS' }
const row = (store: string, name: string, code: string, subcategory: string, target: number | null, actual: number | null, month = periodStart, through = dataThrough) => ({
  store_code: store, store_name: name, short_code: SHORT_CODES[store] ?? null, subcategory_code: code, subcategory, target, actual,
  days_with_actual: actual == null ? 0 : 10, days: 10, period_start: month, data_through: through, targets_available: true,
  // 0.10.0's quantities (#4453): made up from the values, three decimals as the warehouse carries them.
  target_quantity: target == null ? null : Math.round(target / 1.5) / 1000, actual_quantity: actual == null ? null : Math.round(actual / 1.5) / 1000 })
// Figures with paise, so the two-decimal totals can be checked by hand.
const facts = [
  row('9901', 'Lakeside', '010101001', 'Silk sarees', 1250000.49, 1010000.51),
  row('9901', 'Lakeside', '010101002', 'Cotton sarees', 400000.25, 455000.10),
  row('9901', 'Lakeside', '010202001', 'Boys shirts', 300000, null),
  row('9901', 'Lakeside', '010909001', 'Gift wrap', null, 12000.75),
  row('9901', 'Lakeside', '010707001', 'Sandals', 80000, 61000.40),
  row('9901', 'Lakeside', '010808001', 'Wrist watches', 120000, 133500),
  row('9901', 'Lakeside', '011010001', 'Track pants', 45000, 30010.20),
  row('9901', 'Lakeside', '011212001', 'Formal shirts', 150000, 162500.75),
  row('9901', 'Lakeside', '011313001', 'Formal trousers', 110000, 98000.30),
  row('9904', 'Parkside', '010101001', 'Silk sarees', 600000, 480000.35),
  row('9904', 'Parkside', '010202001', 'Boys shirts', 90000, 70000),
  // Hillview's copy is of last month: the page says this month's figures haven't arrived.
  row('9902', 'Hillview', '010404001', 'Belts', 90000, 70000, lastMonth, lastMonthEnd),
  row('9903', 'Riverside', '010505001', 'Handbags', 50000, 40000),
  ...LARGE.map((code, i) => row('9906', 'Bayside', code, `Made-up line ${i + 1}`, 20000 + (i % 37) * 1000.25, 15000 + (i % 29) * 1100.5)),
]
const STORE_NAMES: Record<string, string> = { '9901': 'Lakeside', '9902': 'Hillview', '9903': 'Riverside', '9904': 'Parkside', '9906': 'Bayside' }
// The month's metadata, one row per store and subcategory, of the same refresh. Hillview's is last month's too.
const month = [
  ...['010101001', '010101002', '010202001', '010606001', '010909001', '010707001', '010808001', '011010001', '011212001', '011313001'].map(code => ['9901', code, periodStart, dataThrough]),
  ...['010101001', '010202001'].map(code => ['9904', code, periodStart, dataThrough]),
  // Northgate 9905 has no row in either copy: its figures are being prepared.
  ['9902', '010404001', lastMonth, lastMonthEnd],
  ['9903', '010505001', periodStart, dataThrough],
  ...LARGE.map(code => ['9906', code, periodStart, dataThrough]),
].map(([store_code, subcategory_code, period_start, data_through]) => ({ store_code, store_name: STORE_NAMES[store_code], subcategory_code,
  period_start, data_through, targets_available: true }))

const manifest = JSON.parse(await readFile(resolve(appDir, 'featherbase.json'), 'utf8'))
const declared = datasetsDeclaration.parse(manifest.datasets) as { name: string }[]
async function seed(name: string, rows: Record<string, unknown>[]) {
  const dataset = declared.find(d => d.name === name)!
  // As the platform keys it (featherbase app-datasets.ts): a guard is not part of the definition.
  const version = createHash('sha256').update(JSON.stringify({ ...dataset, guard: undefined })).digest('hex').slice(0, 16)
  await sql`update dataset_snapshot set state = 'superseded' where dataset = ${`feather_dash.${name}`} and state = 'active'`
  const id = randomUUID()
  await sql`insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at, activated_at, row_count)
    values (${id}, ${`feather_dash.${name}`}, ${version}, 'active', ${refreshedAt}, ${refreshedAt}, ${rows.length})`
  for (const r of rows) await sql`insert into app_dataset_row (snapshot_id, row) values (${id}, ${sql.json(r)})`
}
await seed('sales_to_date', facts)
await seed('sales_month', month)

console.log(`Seeded. Sign in at /featherbase/login with the password in this script (PASSWORD) as:
  reader-many@example.test   several stores (Lakeside; Hillview: last month's copy only)
  reader-one@example.test    one store, one section
  reader-quiet@example.test  a section with no target and no sales this month (ready, nothing recorded)
  reader-none@example.test   no access
  reader-bare@example.test   a store with no sections
  #4486, the header's "why" sentence:
  reader-sm@example.test        Store Manager of Lakeside (names the store, not its 8 sections)
  reader-tl2@example.test       Team Leader of 2 sections at Lakeside
  reader-tl4@example.test       Team Leader of 4 sections at Lakeside ("4 sections")
  reader-several@example.test   Team Leader of Sarees and staff in Kids Wear at Lakeside
  reader-assigned@example.test  a subcategory assigned to them at Parkside (old rules)
  reader-preparing@example.test Team Leader at Northgate, whose figures are being prepared (no short name)
  reader-many@example.test      Cluster Manager of two stores: the sentence follows the bar's store picker
  reader-dm2@example.test       Department Manager of Menswear (2 sections) at Lakeside
  reader-staff1@example.test    section staff in Sarees at Lakeside ("because you work in them")
  reader-tl3@example.test       Team Leader of 3 sections at Lakeside (all three named)
  reader-smtl@example.test      Store Manager of Lakeside and Team Leader of Sarees there
  reader-smlarge@example.test   Store Manager of Bayside, a large store (1,600 subcategories)`)
await sql.end()
process.exit(0)
