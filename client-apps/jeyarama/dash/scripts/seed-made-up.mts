// LOCAL DEVELOPMENT ONLY. Fills a throwaway featherbase database, served by a
// featherbase checkout's dev server with this app on its app path, with
// made-up core Tables (fixtures/made-up-org-chart.json), three `dash.report` rows and a cached
// copy of the report's dataset, so every state of the report page can be seen without MotherDuck.
// No real store, person, code or figure.
//
// Normally run for you: `pnpm dev jeyarama/dash --made-up-data` (instance.json's
// `madeUpData`). It needs the server running with a value for every secret the
// app declares, which that command gives it. It refuses a database that is not
// stamped `development`, and is safe to rerun: what exists stays, and the cached
// copy is replaced with one dated today.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { madeUpReportDates } from './made-up-report-dates.ts'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(appDir, '../../..')
// Both are required: without DATABASE_URL the server's db.ts falls back to the default local
// database while the API calls reach another, and the seed lands in the wrong one (#4453).
if (!process.env.DATABASE_URL || !process.env.FEATHERBASE_API_URL)
  throw new Error('Set DATABASE_URL and FEATHERBASE_API_URL to the same throwaway instance, or run: pnpm dev jeyarama/dash --made-up-data')
const api = process.env.FEATHERBASE_API_URL
const server = (path: string) => import(pathToFileURL(resolve(checkout, 'apps/server/src', path)).href)
const { sql } = await server('db.ts')
const { setUserPassword } = await server('auth.ts')
const { datasetsDeclaration } = await server('app-datasets.ts')
const { ACCESS_ROWS, BASE_TABLES, LINKED_TABLES, REPORT_ROWS } = await import(pathToFileURL(resolve(appDir, 'platform-test/base-tables.mjs')).href)
const org = JSON.parse(await readFile(resolve(appDir, 'fixtures/made-up-org-chart.json'), 'utf8'))

/** The local password every made-up reader signs in with (this script's own test value). */
const PASSWORD = 'dash-dev'

const [stamp] = await sql`select value from featherbase.internal_metadata where key = 'environment'`.catch(() => [])
if (stamp?.value !== 'development') throw new Error('Refusing: this database is not stamped development')

const login = await (await fetch(`${api}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ usr: 'Administrator', pwd: 'admin' }) })).json() as { token: string }
async function call<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, { ...init, headers: { authorization: `Bearer ${login.token}`, 'content-type': 'application/json',
    'X-Featherbase-App-Version': `dash@${JSON.parse(await readFile(resolve(appDir, 'package.json'), 'utf8')).version}`, ...init.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`)
  return body as T
}
const post = (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body) })
const save = (table: string, row: Record<string, unknown>) => post('/api/save_row', { table, row }) as Promise<{ row_id: string }>
/** A row made only when its id isn't there: what keeps a rerun safe. */
const keep = async (table: string, id: string, row: Record<string, unknown>) => {
  if (await call(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}`).then(() => false, () => true)) await save(table, row)
}

const [installed] = await sql`select 1 from installed_app where name = 'dash'`
if (!installed) await post('/api/install_app', { name: 'dash' })

// The core Tables, which the warehouse loads on a real instance; the six the provider reads are
// marked as deciding scope, and all are listed for the app to read.
// A database seeded before a Table or column was added gets it now: the provider refuses every
// reader while any Table or column it reads is missing (rama_dw #4588).
type Column = { column_name: string }
for (const table of BASE_TABLES as { name: string; columns: Column[] }[]) {
  const meta = await call<{ columns: Column[] } & Record<string, unknown>>(`/api/table/${encodeURIComponent(table.name)}:meta`).catch(() => null)
  if (!meta) { await post('/api/table_def', table); continue }
  const missing = table.columns.filter(column => !meta.columns.some(have => have.column_name === column.column_name))
  if (missing.length) await call(`/api/table_def/${encodeURIComponent(table.name)}`, { method: 'PUT', body: JSON.stringify({ ...meta, columns: [...meta.columns, ...missing] }) })
}
const linked = await call<{ data: { updated_at: string; value: string }[] }>(`/api/table/App%20Setting?filters=${encodeURIComponent(JSON.stringify([['row_id', '=', 'dash.linked_tables']]))}&fields=${encodeURIComponent('["updated_at","value"]')}`)
const [listed] = linked.data
if (!listed || listed.value !== JSON.stringify(LINKED_TABLES))
  await save('App Setting', { row_id: 'dash.linked_tables', value: JSON.stringify(LINKED_TABLES), ...(listed ? { updated_at: listed.updated_at } : {}) })

// The instance's MotherDuck source, played by a local DuckDB path that nothing opens: the
// platform serves the cached copy below without querying it.
const sourceExists = await call('/api/table/Data%20Source/motherduck').then(() => true, () => false)
if (!sourceExists) await post('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'DASH_LOCAL_DUCKDB', access: 'read_only' })

// Three made-up Dives, one per filter shape. No Dive of these ids exists and no service account is
// set, so the sales report falls to its quick view and the other two to "This report couldn't open".
for (const row of REPORT_ROWS as { report_key: string }[]) await keep('dash.report', row.report_key, row)
// #1046: every made-up report goes to everyone holding Dash Reader, as one bundle, so each made-up
// reader opens them; the Report access page shows the row, and a made-up Report Access Manager.
const bundles = await call<{ data: { row_id: string }[] }>(`/api/table/dash.report_bundle?filters=${encodeURIComponent(JSON.stringify([['bundle_name', '=', 'Store reports']]))}&fields=${encodeURIComponent('["row_id"]')}`)
const bundle = bundles.data[0]?.row_id ?? (await save('dash.report_bundle', { bundle_name: 'Store reports', notes: 'Every made-up report, for everyone in the stores' })).row_id
for (const row of REPORT_ROWS as { report_key: string }[])
  await save('dash.report_bundle_member', { report_bundle: bundle, report: row.report_key }).catch(() => {})
await save('dash.report_access', { report_bundle: bundle, role: 'Dash Reader' }).catch(() => {})

for (const [code, name] of org.clusters) await keep('Cluster', code, { code, name })
for (const region of org.regions) await keep('Operating Region', region, { region })
for (const [code, name, is_store, cluster, operating_region] of org.sites) await keep('Site', code, { code, name, is_store, cluster, operating_region })
for (const [plant_code, plant_type, site] of org.plants) await keep('Plant', plant_code, { plant_code, plant_type, site })
for (const [row_id, name, site] of org.floors) await keep('Store Floor', row_id, { row_id, name, site })
for (const [row_id, name, site, floor, status] of org.sections) await keep('Section', row_id, { row_id, name, site, floor, status })
const tree = org.merchandise
for (const division of tree.divisions) await keep('Division', division, { division })
for (const [subdivision, division] of tree.subdivisions) await keep('Subdivision', subdivision, { subdivision, division })
for (const [category, subdivision] of tree.categories) await keep('Category', category, { category, subdivision })
const categoryOf = new Map<string, string>(tree.placed)
const lineage = (code: string) => {
  const category = categoryOf.get(code)
  if (!category) return {}
  const subdivision = tree.categories.find(([name]: string[]) => name === category)[1]
  return { category, subdivision, division: tree.subdivisions.find(([name]: string[]) => name === subdivision)[1] }
}
for (const [row_id, subcategory, subcategory_type] of org.subcategories) await keep('Subcategory', row_id, { row_id, subcategory, subcategory_type, ...lineage(row_id) })
const placement = (store: string, subcategory: string, section: string) => {
  const section_subcategory_id = `${store}-${subcategory}-2026-01-01`
  return keep('Section Subcategory', section_subcategory_id, { section_subcategory_id, store, subcategory, section, starts_on: '2026-01-01', source_key: 'Made-up' })
}
for (const [store, subcategory, section] of org.placements) await placement(store, subcategory, section)
// #4453: a large store, Bayside 9906, with 1,600 made-up subcategories; two sections name a few of them.
const LARGE = Array.from({ length: 1600 }, (_, i) => `02${String(Math.floor(i / 100)).padStart(2, '0')}${String(i % 100).padStart(5, '0')}`)
for (const code of LARGE.slice(0, 6)) await keep('Subcategory', code, { row_id: code, subcategory: `Made-up line ${Number(LARGE.indexOf(code)) + 1}`, subcategory_type: 'Merchandise' })
for (const code of LARGE.slice(0, 3)) await placement('BAY', code, 'BAY-S1')
for (const code of LARGE.slice(3, 6)) await placement('BAY', code, 'BAY-S2')

/** A made-up person who can sign in, a Dash Reader, and whatever roles are named. */
async function person(email: string, full_name: string, roles: string[] = [], reader = true) {
  const [found] = await sql`select row_id from person where lower(email) = ${email}`
  const id = found ? String(found.row_id) : String((await post('/api/table/Person', { email, full_name, enabled: true,
    roles: [...(reader ? ['Dash Reader'] : []), ...roles].map(role => ({ role })) })).row_id)
  await setUserPassword(id, PASSWORD)
  return id
}
await keep('Role', 'Master Data Editor', { row_id: 'Master Data Editor' })
// #1046: Dash Reader goes to everyone who signs in, and the reports given to each person decide
// whether Dash opens for them. Local only: on a real instance a System Manager sets this.
await save('System Settings', { everyone_roles: 'Dash Reader' })
// One reader per state of the report page.
let code = 3000
for (const reader of org.readers as { key: string; name: string; jobs: [string, string, Record<string, string>][] | null }[]) {
  const employee = String(++code)
  const id = await person(`reader-${reader.key}@example.test`, reader.name)
  if (!reader.jobs) continue
  await keep('Employee', employee, { employee_code: employee, name: reader.name, person: id, status: 'Current' })
  for (const [i, [job, site, where]] of reader.jobs.entries()) {
    const assignment_id = `JA-${employee}-${i + 1}`
    await keep('Job Assignment', assignment_id, { assignment_id, employee, job, site, ...where, starts_on: '2026-01-01', source_key: 'Made-up' })
  }
}

// rama_dw #4588: a made-up buyer, whose reach is a category across the stores of a region.
for (const buyer of tree.buyers as { key: string; name: string; code: string; assignments: [string, string, string][] }[]) {
  const id = await person(`reader-${buyer.key}@example.test`, buyer.name)
  await keep('Employee', buyer.code, { employee_code: buyer.code, name: buyer.name, person: id, status: 'Current' })
  for (const [i, [responsibility, category, operating_region]] of buyer.assignments.entries()) {
    const assignment_id = `MA-${buyer.code}-${i + 1}`
    await keep('Merchandise Assignment', assignment_id, { assignment_id, employee: buyer.code, responsibility, category, operating_region, starts_on: '2026-01-01', source_key: 'Made-up' })
  }
}

// Both copies describe the same made-up month to date, including today. Hillview
// deliberately retains last month's figures to demonstrate the no-data-yet state.
const { refreshedAt, dataThrough, periodStart, lastMonth, lastMonthEnd } = madeUpReportDates(Date.now())
// Lakeside and Bayside carry a short code, as the warehouse's store master does; the header still names them by name (#967 point 13).
const SHORT_CODES: Record<string, string> = { '9901': 'LKS', '9906': 'BYS' }
const row = (store: string, name: string, code: string, subcategory: string, target: number | null, actual: number | null, month = periodStart, through = dataThrough) => ({
  store_code: store, store_name: name, short_code: SHORT_CODES[store] ?? null, subcategory_code: code, subcategory, target, actual,
  days_with_actual: actual == null ? 0 : Number(through.slice(8, 10)), days: Number(through.slice(8, 10)), period_start: month, data_through: through, targets_available: true,
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
  // Hillview's copy is of last month: the page says this month's figures haven't arrived.
  row('9902', 'Hillview', '010404001', 'Belts', 90000, 70000, lastMonth, lastMonthEnd),
  row('9903', 'Riverside', '010505001', 'Handbags', 50000, 40000),
  ...LARGE.map((code, i) => row('9906', 'Bayside', code, `Made-up line ${i + 1}`, 20000 + (i % 37) * 1000.25, 15000 + (i % 29) * 1100.5)),
]
const STORE_NAMES: Record<string, string> = { '9901': 'Lakeside', '9902': 'Hillview', '9903': 'Riverside', '9906': 'Bayside' }
// The month's metadata, one row per store and subcategory, of the same refresh. Hillview's is last month's too.
const month = [
  ...['010101001', '010101002', '010202001', '010606001', '010909001', '010707001', '010808001', '011010001', '011212001', '011313001'].map(code => ['9901', code, periodStart, dataThrough]),
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
  // A rerun replaces the copy: the earlier ones are made-up too, and nobody can go back to them.
  await sql`delete from app_dataset_row where snapshot_id in (select row_id from dataset_snapshot where dataset = ${`dash.${name}`})`
  await sql`delete from dataset_snapshot where dataset = ${`dash.${name}`}`
  const id = randomUUID()
  await sql`insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at, activated_at, row_count)
    values (${id}, ${`dash.${name}`}, ${version}, 'active', ${refreshedAt}, ${refreshedAt}, ${rows.length})`
  for (const r of rows) await sql`insert into app_dataset_row (snapshot_id, row) values (${id}, ${sql.json(r)})`
}
await seed('sales_to_date', facts)
await seed('sales_month', month)
// #750: last month's copies, the whole month, with figures of their own so the two months never agree.
const lastFacts = [
  row('9901', 'Lakeside', '010101001', 'Silk sarees', 2400000.80, 2515000.35, lastMonth, lastMonthEnd),
  row('9901', 'Lakeside', '010101002', 'Cotton sarees', 780000, 702500.60, lastMonth, lastMonthEnd),
  row('9901', 'Lakeside', '010202001', 'Boys shirts', 560000, 610250, lastMonth, lastMonthEnd),
  row('9901', 'Lakeside', '010707001', 'Sandals', 150000, 98000.45, lastMonth, lastMonthEnd),
  row('9901', 'Lakeside', '010808001', 'Wrist watches', 230000, 241000, lastMonth, lastMonthEnd),
  row('9901', 'Lakeside', '011212001', 'Formal shirts', 290000, 301500.25, lastMonth, lastMonthEnd),
  row('9902', 'Hillview', '010404001', 'Belts', 90000, 70000, lastMonth, lastMonthEnd),
]
await seed('sales_last_month', lastFacts)
await seed('sales_last_month_meta', [...new Set(month.map(m => `${m.store_code} ${m.subcategory_code}`))].map(key => {
  const [store_code, subcategory_code] = key.split(' ')
  return { store_code, store_name: STORE_NAMES[store_code], subcategory_code, period_start: lastMonth, data_through: lastMonthEnd, targets_available: true }
}))

// #1046: someone who gives reports, and nothing else: the Report access page (/dash/?view=access).
await person('access-manager@example.test', 'Made-up Access Manager', ['Report Access Manager'], false)

// Each person is a Reader and shows one state of Your sections.
for (const staff of org.sectionPeople as { key: string; name: string; code: string | null; roles: string[]; jobs: [string, string, string, string | null, string | null][] }[]) {
  const id = await person(`sections-${staff.key}@example.test`, staff.name, staff.roles)
  if (staff.code) await keep('Employee', staff.code, { employee_code: staff.code, name: staff.name, person: id, status: 'Current' })
}
for (const [employee_code, name] of org.noSignIn) await keep('Employee', employee_code, { employee_code, name, status: 'Current' })
for (const staff of org.sectionPeople as { code: string | null; jobs: [string, string, string, string | null, string | null][] }[])
  for (const [assignment_id, job, site, section, reports_to] of staff.jobs)
    await keep('Job Assignment', assignment_id, { assignment_id, employee: staff.code, job, site, section, reports_to, starts_on: '2026-10-01', source_key: 'Made-up' })

// The proof it worked: a made-up Store Manager opens Lakeside's report and gets figures.
const signIn = await fetch(`${api}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ usr: 'reader-sm@example.test', pwd: PASSWORD }) })
if (!signIn.ok) throw new Error(`Signing in as a made-up reader failed: HTTP ${signIn.status}`)
const version = JSON.parse(await readFile(resolve(appDir, 'package.json'), 'utf8')).version
const opened = await fetch(`${api}/api/app_reads/dash/report`, { method: 'POST', headers: { 'content-type': 'application/json',
  authorization: `Bearer ${((await signIn.json()) as { token: string }).token}`, 'X-Featherbase-App-Version': `dash@${version}` },
  body: JSON.stringify({ payload: { report: 'sales', store: '9901' } }) })
const answer = await opened.json() as { result?: { state?: string; rows?: unknown[] } }
if (!opened.ok || !answer.result?.rows?.length) throw new Error(`A made-up reader's report has no figures: HTTP ${opened.status} ${JSON.stringify(answer).slice(0, 300)}`)

const says = (people: { key: string; says: string }[], prefix: string) =>
  people.map(p => `  ${`${prefix}-${p.key}@example.test`.padEnd(36)} ${p.says}`).join('\n')
console.log(`To see figures, sign in at /featherbase/login with:
  email:    reader-sm@example.test   (Store Manager of a made-up store, Lakeside)
  password: ${PASSWORD}
Other made-up people, same password. Each shows one state of the page:
${says(org.readers, 'reader')}
Your sections (/dash/?view=sections), same password:
${says(org.sectionPeople, 'sections')}
Report access (/dash/?view=access), same password:
  access-manager@example.test          Report Access Manager: gives reports and bundles, and sees who has what`)
await sql.end()
process.exit(0)
