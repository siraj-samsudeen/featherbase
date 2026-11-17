// LOCAL PROTOTYPE ONLY (featherbase #1223). Signs in as each made-up manager that
// seed-manager-access.mts set up and tries what they should and should not be able to do, through
// the same HTTP API the Featherbase admin uses. Prints one line per check: what was tried, what
// happened. Writes only to the made-up instance, and puts back what it changed.
const api = process.env.FEATHERBASE_API_URL ?? 'http://localhost:3123'
const PASSWORD = 'dash-dev'

async function as(email: string, pwd = PASSWORD) {
  const login = await (await fetch(`${api}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usr: email, pwd }) })).json() as { token: string }
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${api}${path}`, { ...init, headers: { authorization: `Bearer ${login.token}`, 'content-type': 'application/json', ...init.headers } })
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) as any }
  }
  const list = async (table: string, fields: string[]) => {
    const r = await call(`/api/table/${encodeURIComponent(table)}?fields=${encodeURIComponent(JSON.stringify(['row_id', ...fields]))}&limit_page_length=500`)
    return r.ok ? (r.body.data as Record<string, unknown>[]) : `refused (${r.status})`
  }
  const save = (table: string, row: Record<string, unknown>) => call('/api/save_row', { method: 'POST', body: JSON.stringify({ table, row }) })
  const get = (table: string, id: string) => call(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}`)
  return { call, list, save, get }
}
const admin = await as('Administrator', 'admin')
const results: [string, string, string][] = []
const note = (who: string, tried: string, got: string) => { results.push([who, tried, got]); console.log(`${who.padEnd(10)} | ${tried.padEnd(66)} | ${got}`) }
const values = (rows: Record<string, unknown>[] | string, column: string) =>
  typeof rows === 'string' ? rows : `${rows.length} rows; ${column}: ${[...new Set(rows.map(r => String(r[column] ?? '(blank)')))].sort().join(', ')}`
const outcome = (r: { ok: boolean; status: number; body: any }) => r.ok ? 'ALLOWED' : `refused (${r.status}: ${String(r.body?.message ?? r.body?.error ?? '').slice(0, 70)})`

// Undo any row made here, as the administrator.
const made: [string, string][] = []
async function tryCreate(who: string, user: Awaited<ReturnType<typeof as>>, tried: string, table: string, row: Record<string, unknown>) {
  const r = await user.save(table, row)
  note(who, tried, outcome(r))
  if (r.ok) made.push([table, String(r.body.row_id)])
}
async function tryUpdate(who: string, user: Awaited<ReturnType<typeof as>>, tried: string, table: string, id: string, change: Record<string, unknown>) {
  const before = await admin.get(table, id)
  const r = await user.save(table, { row_id: id, updated_at: before.body.updated_at, ...change })
  note(who, tried, outcome(r))
  if (r.ok) {
    const now = await admin.get(table, id)
    const back = Object.fromEntries(Object.keys(change).map(k => [k, before.body[k] ?? null]))
    await admin.save(table, { row_id: id, updated_at: now.body.updated_at, ...back })
  }
}

for (const [who, email] of [['Store', 'reader-sm@example.test'], ['Floor', 'reader-fm@example.test'], ['Category', 'reader-buyer@example.test']] as const) {
  const user = await as(email)
  const me = await user.call('/api/whoami')
  note(who, 'Opens the Featherbase admin (whoami admin)', String(me.body?.capabilities?.admin ?? me.body?.admin ?? JSON.stringify(me.body).slice(0, 80)))
  if (who !== 'Category') {
    note(who, 'Lists Section', values(await user.list('Section', ['site', 'floor']), 'site'))
    note(who, 'Lists Store Floor', values(await user.list('Store Floor', ['site']), 'row_id'))
    note(who, 'Lists Section Subcategory', values(await user.list('Section Subcategory', ['store', 'section']), 'store'))
    note(who, 'Lists Job Assignment (by site)', values(await user.list('Job Assignment', ['site', 'section', 'job']), 'site'))
    note(who, 'Lists Employee (whole staff list?)', values(await user.list('Employee', ['name']), 'nothing').split(';')[0])
    await tryUpdate(who, user, 'Renames a section in ANOTHER store (Hillview HIL-S1)', 'Section', 'HIL-S1', { name: 'Renamed by prototype' })
    await tryUpdate(who, user, 'Moves own-store section LKS-S1 to Hillview', 'Section', 'LKS-S1', { site: 'HIL' })
    await tryUpdate(who, user, 'Renames own section LKS-S1 (first floor)', 'Section', 'LKS-S1', { name: 'Sarees (renamed)' })
    await tryUpdate(who, user, 'Renames LKS-S3 (Kids Wear, second floor)', 'Section', 'LKS-S3', { name: 'Kids (renamed)' })
    await tryCreate(who, user, 'Creates a Job Assignment at Hillview', 'Job Assignment', { assignment_id: `PROBE-${who}-1`, employee: '2001', job: 'Staff', site: 'HIL', starts_on: '2026-11-16' })
    await tryCreate(who, user, 'Creates a Job Assignment with NO site, job Director', 'Job Assignment', { assignment_id: `PROBE-${who}-2`, employee: '2001', job: 'Director', starts_on: '2026-11-16' })
    await tryCreate(who, user, 'Creates a Store Manager job at own store for a staff member', 'Job Assignment', { assignment_id: `PROBE-${who}-3`, employee: '2003', job: 'Store Manager', site: 'LKS', starts_on: '2026-11-16' })
  } else {
    note(who, 'Lists Merchandise Assignment', values(await user.list('Merchandise Assignment', ['category', 'division']), 'category'))
    note(who, 'Lists Subcategory', values(await user.list('Subcategory', ['category']), 'category'))
    await tryCreate(who, user, 'Makes a buyer of Sarees (own category)', 'Merchandise Assignment', { assignment_id: 'PROBE-C-1', employee: '2021', responsibility: 'Buyer', category: 'Sarees', operating_region: 'East', starts_on: '2026-11-16' })
    await tryCreate(who, user, 'Makes a buyer of Belts (another category)', 'Merchandise Assignment', { assignment_id: 'PROBE-C-2', employee: '2021', responsibility: 'Buyer', category: 'Belts', operating_region: 'East', starts_on: '2026-11-16' })
    await tryCreate(who, user, 'Makes a Division head of Fashion (no category set)', 'Merchandise Assignment', { assignment_id: 'PROBE-C-3', employee: '2021', responsibility: 'Division head', division: 'Fashion', starts_on: '2026-11-16' })
  }
}
// Dash still works for them: the store manager's report reaches Lakeside only.
const sm = await as('reader-sm@example.test')
const stores = await sm.call('/api/app_reads/dash/stores', { method: 'POST', body: JSON.stringify({ payload: {} }), headers: { 'X-Featherbase-App-Version': `dash@${process.env.DASH_VERSION ?? ''}` } })
note('Store', 'Dash: stores the report offers', stores.ok ? JSON.stringify(stores.body.result ?? stores.body).slice(0, 90) : `HTTP ${stores.status} ${JSON.stringify(stores.body).slice(0, 80)}`)

for (const [table, id] of made) await admin.call(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
console.log(`\n(${made.length} probe rows removed)`)
