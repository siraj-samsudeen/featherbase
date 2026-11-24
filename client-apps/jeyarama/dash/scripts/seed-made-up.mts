// LOCAL DEVELOPMENT ONLY. Fills a throwaway featherbase database, served by a
// featherbase checkout's dev server with this app on its app path, with
// made-up core Tables (fixtures/made-up-org-chart.json) and three `dash.report` rows, so the report
// page's states can be seen without MotherDuck.
// No real store, person, code or figure.
//
// Normally run for you: `pnpm dev jeyarama/dash --made-up-data` (instance.json's
// `madeUpData`). It needs the server running with a value for every secret the
// app declares, which that command gives it. It refuses a database that is not
// stamped `development`, and is safe to rerun: what exists stays, and the made-up Department Managers
// without a seeded department go back to their start (Devi pre-filled, Kiran
// with the set-up card), so rerunning it restarts a used-up department test.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

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

// The instance's MotherDuck source, played by a local DuckDB path that nothing opens: Dash's
// one dataset, organisation_dives, is read live only by Add a Dive, which says it can't reach it.
const sourceExists = await call('/api/table/Data%20Source/motherduck').then(() => true, () => false)
if (!sourceExists) await post('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'DASH_LOCAL_DUCKDB', access: 'read_only' })

// Three made-up Dives, one per filter shape. No Dive of these ids exists and no service account is
// set, so each says "This report couldn't open".
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
// #4453: Bayside 9906's made-up subcategories; two sections name them.
const LARGE = Array.from({ length: 6 }, (_, i) => `02${String(Math.floor(i / 100)).padStart(2, '0')}${String(i % 100).padStart(5, '0')}`)
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
// #1223: as on production, the master data team reads the master Tables in Featherbase, so record links open for them.
const [granted] = await sql`select 1 from featherbase.permission where role = 'Master Data Editor' limit 1`
if (!granted) for (const table of BASE_TABLES as { name: string }[])
  await save('Permission', { ref_table: table.name, role: 'Master Data Editor', operation: 'read', scope_mode: 'all', column_rule: 'every' })
// #1046: Dash Reader goes to everyone who signs in, and the reports given to each person decide
// whether Dash opens for them. Local only: on a real instance a System Manager sets this.
await save('System Settings', { everyone_roles: 'Dash Reader' })
// #1218: HR's titles some made-up job assignments carry.
for (const designation of org.designations as string[]) await keep('Designation', designation, { designation })
// One reader per state of the report page.
let code = 3000
for (const reader of org.readers as { key: string; name: string; jobs: [string, string, Record<string, string>][] | null; roles?: string[] }[]) {
  const employee = String(++code)
  const id = await person(`reader-${reader.key}@example.test`, reader.name, reader.roles)
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

// rama_dw #4588: a Cluster row names its head in cluster_manager, a text column holding the head's Employee id.
// A rerun sets the head on a row seeded before.
async function setHead(table: string, id: string, column: string, employee: string) {
  const row = await call<Record<string, unknown>>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}`)
  if (row[column] !== employee) await save(table, { row_id: id, updated_at: row.updated_at, [column]: employee })
}
for (const head of org.heads.people as { key: string; name: string; code: string; cluster: string }[]) {
  const id = await person(`reader-${head.key}@example.test`, head.name)
  await keep('Employee', head.code, { employee_code: head.code, name: head.name, person: id, status: 'Current' })
  await setHead('Cluster', head.cluster, 'cluster_manager', head.code)
}

// #1046: someone who gives reports, and nothing else: the Report access page (/dash/?view=access).
await person('access-manager@example.test', 'Made-up Access Manager', ['Report Access Manager'], false)
// #1222: someone who tests the app by viewing as anyone, read-only, and nothing else.
await person('view-as-tester@example.test', 'Made-up Tester', ['View As Tester'], false)
// #1222 (E): someone who manages report access and may view as anyone: "What a person sees" offers View as.
await person('view-as-manager@example.test', 'Made-up Access Tester', ['Report Access Manager', 'View As Tester'], false)
// #1216: same-named people on that page. Four current Kumars are among the readers above; here a
// Kumar who has left and someone not on the staff list, each given a report directly with one current Kumar.
const leftKumar = await person('reader-same-left@example.test', 'Kumar')
await keep('Employee', '3990', { employee_code: '3990', name: 'Kumar', person: leftKumar, status: 'Left' })
const outsider = await person('outsider@example.test', 'Made-up Outsider')
for (const receiver of [leftKumar, outsider, await person('reader-same-leader@example.test', 'Kumar')])
  await save('dash.report_access', { report: 'sales', person: receiver }).catch(() => {})

// Each person is a Reader and shows one state of Your sections.
for (const staff of org.sectionPeople as { key: string; name: string; code: string | null; roles: string[]; jobs: [string, string, string, string | null, string | null][] }[]) {
  const id = await person(`sections-${staff.key}@example.test`, staff.name, staff.roles)
  if (staff.code) await keep('Employee', staff.code, { employee_code: staff.code, name: staff.name, person: id, status: 'Current' })
}
for (const [employee_code, name] of org.noSignIn) await keep('Employee', employee_code, { employee_code, name, status: 'Current' })
for (const staff of org.sectionPeople as { code: string | null; jobs: [string, string, string, string | null, string | null][] }[])
  for (const [assignment_id, job, site, section, reports_to] of staff.jobs)
    await keep('Job Assignment', assignment_id, { assignment_id, employee: staff.code, job, site, section, reports_to, starts_on: '2026-10-01', source_key: 'Made-up' })

// #1217: a grant the company-wide manager gave one of Hema's team, which Hema sees but can't take away.
const [usha] = await sql`select row_id from person where lower(email) = 'sections-buyerone@example.test'`
await save('dash.report_access', { report: 'vendor_sales', person: String(usha.row_id) }).catch(() => {})
// Hema reaches Sarees across the East's stores, so she can give the reports filtered by subcategory, but not the whole-stores one.
await keep('Merchandise Assignment', 'MA-2020-1', { assignment_id: 'MA-2020-1', employee: '2020', responsibility: 'Category head', category: 'Sarees', operating_region: 'East', starts_on: '2026-01-01', source_key: 'Made-up' })
// #1246: Hema's two Buyer Sections in the East: Silk sarees (Usha buys it) and Everyday sarees (no buyer yet).
await keep('Buyer Section', 'East-Silk sarees', { buyer_section_id: 'East-Silk sarees', name: 'Silk sarees', operating_region: 'East', buyer: '2021', category_head: '2020', starts_on: '2026-11-01', source_key: 'Made-up' })
await keep('Buyer Section', 'East-Everyday sarees', { buyer_section_id: 'East-Everyday sarees', name: 'Everyday sarees', operating_region: 'East', category_head: '2020', starts_on: '2026-11-01', source_key: 'Made-up' })
await keep('Buyer Section Subcategory', 'East-010101001-made-up', { buyer_section_subcategory_id: 'East-010101001-made-up', buyer_section: 'East-Silk sarees', subcategory: '010101001', starts_on: '2026-11-01', source_key: 'Made-up' })
await keep('Buyer Section Subcategory', 'East-010101002-made-up', { buyer_section_subcategory_id: 'East-010101002-made-up', buyer_section: 'East-Everyday sarees', subcategory: '010101002', starts_on: '2026-11-01', source_key: 'Made-up' })

// #1195: departments already set up, which the made-up Department Manager meets on Your department.
for (const [department_id, store, name, manager, sections] of org.departments as [string, string, string, string, string[]][]) {
  await keep('Department', department_id, { department_id, store, name, manager, starts_on: '2026-10-01', source_key: 'Made-up' })
  for (const section of sections)
    await keep('Department Section', `${department_id}-${section}`, { department_section_id: `${department_id}-${section}`, store, department: department_id, section, starts_on: '2026-10-01', source_key: 'Made-up' })
}

// #1205: every run puts the made-up Department Managers without a seeded department back to their
// start, so a used-up test begins again: what they or a reviewer did is removed (local data only,
// on a database stamped development), then the fixture's pre-fills are made again through Dash's
// own load action, as the production loader makes them.
const seeded = new Set((org.departments as [string, string, string, string][]).map(([, , , manager]) => manager))
const starting = (org.sectionPeople as { code: string | null; jobs: [string, string, ...unknown[]][] }[])
  .flatMap(staff => staff.jobs.filter(([, job]) => job === 'Department Manager').map(([assignment]) => ({ assignment, employee: staff.code! })))
  .filter(({ employee }) => !seeded.has(employee))
if (!starting.length) throw new Error('The made-up org chart has no Department Manager without a department to start from')
const proposals = (await sql`select row_id from featherbase.change_proposal where about->>'job_assignment' in ${sql(starting.map(s => s.assignment))}
  and about->>'kind' in ('department', 'department_section')`).map((r: { row_id: string }) => r.row_id)
const departments = (await sql`select row_id from featherbase.department where manager in ${sql(starting.map(s => s.employee))}`).map((r: { row_id: string }) => r.row_id)
const links = departments.length ? (await sql`select row_id from featherbase.department_section where department in ${sql(departments)}`).map((r: { row_id: string }) => r.row_id) : []
await sql.begin(async (tx: typeof sql) => {
  if (proposals.length) {
    await tx`delete from featherbase.change_proposal_approver where parent in ${tx(proposals)}`
    await tx`delete from featherbase.change_proposal_column where parent in ${tx(proposals)}`
    await tx`delete from featherbase.change_proposal where row_id in ${tx(proposals)}`
  }
  if (links.length) await tx`delete from featherbase.version where ref_table = 'Department Section' and ref_name in ${tx(links)}`
  if (departments.length) await tx`delete from featherbase.version where ref_table = 'Department' and ref_name in ${tx(departments)}`
  if (links.length) await tx`delete from featherbase.department_section where row_id in ${tx(links)}`
  if (departments.length) await tx`delete from featherbase.department where row_id in ${tx(departments)}`
})
for (const [store, managers] of Object.entries(Object.groupBy(org.prefills as { store: string; employee: string; sections: string[]; flagged: string[] }[], p => p.store))) {
  const { result } = await post('/api/app_actions/dash/prefill_departments', { idempotencyKey: randomUUID(),
    payload: { store, managers: managers!.map(({ employee, sections, flagged }) => ({ employee, sections, flagged })) } }) as { result: { results: { name: string; outcome: string; notes: string[] }[] } }
  const failed = result.results.filter(r => r.outcome !== 'pre-filled')
  if (failed.length) throw new Error(`A made-up pre-fill did not take: ${JSON.stringify(failed)}`)
}

// #1218: the made-up reports given to the job Store Manager too, so a Store Manager's access is the same in both models.
// #1277: the starting business roles, as a System Manager's Add The Starting Roles click writes them (the Tables
// decide scope, so a Report Access Manager can't); a rerun adds nothing. Nothing switches Dash to business roles:
// a made-up instance starts on the old rules, as every instance does.
await save('dash.report_access', { report_bundle: bundle, job: 'Store Manager' }).catch(() => {})
await post('/api/app_actions/dash/add_starting_roles', { idempotencyKey: randomUUID(), payload: {} })

// The proof it worked: a made-up Store Manager opens Lakeside's report. Its figures are the Dive's own since #1366
// (no sales copies), so the read answers ready, headed by the store, with no rows of its own.
const signIn = await fetch(`${api}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ usr: 'reader-sm@example.test', pwd: PASSWORD }) })
if (!signIn.ok) throw new Error(`Signing in as a made-up reader failed: HTTP ${signIn.status}`)
const version = JSON.parse(await readFile(resolve(appDir, 'package.json'), 'utf8')).version
const opened = await fetch(`${api}/api/app_reads/dash/report`, { method: 'POST', headers: { 'content-type': 'application/json',
  authorization: `Bearer ${((await signIn.json()) as { token: string }).token}`, 'X-Featherbase-App-Version': `dash@${version}` },
  body: JSON.stringify({ payload: { report: 'sales', store: '9901' } }) })
const answer = await opened.json() as { result?: { state?: string; heading?: { name?: string | null } } }
if (!opened.ok || answer.result?.state !== 'ready' || answer.result.heading?.name !== 'Lakeside')
  throw new Error(`A made-up reader's report does not open at Lakeside: HTTP ${opened.status} ${JSON.stringify(answer).slice(0, 300)}`)

const says = (people: { key: string; says: string }[], prefix: string) =>
  people.map(p => `  ${`${prefix}-${p.key}@example.test`.padEnd(36)} ${p.says}`).join('\n')
console.log(`To see figures, sign in at /featherbase/login with:
  email:    reader-sm@example.test   (Store Manager of a made-up store, Lakeside)
  password: ${PASSWORD}
Other made-up people, same password. Each shows one state of the page:
${says(org.readers, 'reader')}
${says([...tree.buyers, ...org.heads.people], 'reader')}
Your sections (/dash/?view=sections), same password:
${says(org.sectionPeople, 'sections')}
Report access (/dash/?view=access), same password:
  access-manager@example.test          Report Access Manager: gives reports and bundles, and sees who has what
  sections-categoryhead@example.test   Team Report Manager: gives reports to her own team only, two of them named Vinod Buyer-Two (#1217)
Business roles (#1218, #1277; the old rules decide until a System Manager sets the Dash access source): /dash/?view=roles, ?view=explain and ?view=changes, as access-manager@example.test:
  explain reader-sm (Selvi, Store Manager), reader-buyer (Bina, Category head of Sarees, East), reader-opsexec (Sundar, to Correct),
  reader-staff1 (Siva, who would lose Dash) and reader-office (Omar, Head Office: no Dash until a role is given by hand).
View as (#1222), same password:
  view-as-tester@example.test          View As Tester: sees Dash as any of the people above, for viewing only
  view-as-manager@example.test         Report Access Manager and View As Tester: "What a person sees" offers View as`)
await sql.end()
process.exit(0)
