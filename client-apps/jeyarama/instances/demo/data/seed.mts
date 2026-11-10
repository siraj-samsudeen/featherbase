// Loads the Banyan Retail demo (#1123) into a demo instance through its API, as an administrator and
// as the demo people, so every save runs the full trigger chain. Safe to rerun: a row is written
// only when its id is not there yet, so what visitors changed stays until the instance is wiped.
//
//   FEATHERBASE_API_URL=https://featherbase-dev.up.railway.app FEATHERBASE_ADMIN_PASSWORD=… \
//     node --import tsx client-apps/jeyarama/instances/demo/data/seed.mts
//
// Locally `pnpm dev jeyarama/demo --made-up-data` runs it, and it also builds the made-up
// warehouse in DEMO_WAREHOUSE_DIR. On dev the warehouse is built inside the container (instance.md).
//
// It refuses any address but this machine and the public dev, a production environment, and an
// instance holding a person whose email is not on a reserved example domain.
import { banyan, EMAIL_DOMAIN } from './banyan.mjs'
import { DEMO_TABLES, LINKED_TABLES } from './tables.mjs'
import { TASKER, TICKET_TYPES, TICKETS, day } from './work.mjs'

const ALLOWED_HOSTS = ['127.0.0.1', 'localhost', 'featherbase-dev.up.railway.app']
/** The password every demo login shares; published on purpose (instance.md). */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'banyan-demo'

const api = process.env.FEATHERBASE_API_URL
if (!api) throw new Error('Set FEATHERBASE_API_URL to the demo instance')
const host = new URL(api).hostname
if (!ALLOWED_HOSTS.includes(host)) throw new Error(`Refusing ${host}: the demo seed loads only this machine or the public dev`)
const local = host === '127.0.0.1' || host === 'localhost'
const adminPassword = process.env.FEATHERBASE_ADMIN_PASSWORD || (local ? 'admin' : '')
if (!adminPassword) throw new Error('Set FEATHERBASE_ADMIN_PASSWORD (never written down here)')
const versions: Record<string, string> = {}

async function raw(path: string, init: RequestInit & { token?: string; app?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }
  const app = init.app ?? /^\/api\/table\/(dash|tasker|tickets)\./.exec(path)?.[1]
  if (app && versions[app]) headers['X-Featherbase-App-Version'] = `${app}@${versions[app]}`
  const response = await fetch(`${api}${path}`, { ...init, headers, redirect: 'error' })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}
async function signIn(usr: string, pwd: string) {
  const r = await raw('/api/login', { method: 'POST', body: JSON.stringify({ usr, pwd }) })
  if (!r.ok) throw new Error(`Signing in as ${usr} failed: HTTP ${r.status}`)
  return String(r.body.token)
}
const ping = await raw('/api/ping')
if (ping.body.environment === 'production') throw new Error('Refusing a production instance')
const admin = await signIn('Administrator', adminPassword)
async function call<T = any>(path: string, init: RequestInit & { app?: string } = {}, token = admin): Promise<T> {
  const r = await raw(path, { ...init, token })
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`)
  return r.body as T
}
const post = (path: string, body: unknown, token = admin, app?: string) => call(path, { method: 'POST', body: JSON.stringify(body), app }, token)
/** An app's own Tables (and its App Settings) are written as that app's current client. */
const owner = (table: string, row: Record<string, unknown>) =>
  /^(dash|tasker|tickets)\./.exec(table === 'App Setting' ? String(row.row_id ?? '') : table === 'Comment' ? String(row.ref_table ?? '') : table)?.[1]
const save = (table: string, row: Record<string, unknown>, token = admin) => post('/api/save_row', { table, row }, token, owner(table, row))
/** A new row with an id of our choosing (save_row with an id updates). */
const create = (table: string, row: Record<string, unknown>) => post(`/api/table/${encodeURIComponent(table)}`, row, admin, owner(table, row))
const PAGE = 500
const q = (filters: unknown[], fields: string[], start: number) =>
  `?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}&order_by=${encodeURIComponent('row_id asc')}&limit_start=${start}&limit_page_length=${PAGE}`
/** Every matching row, a page at a time: the API serves at most a page per call. */
async function list(table: string, filters: unknown[] = [], fields = ['row_id']) {
  const rows: any[] = []
  for (let start = 0; ; start += PAGE) {
    const page = (await call<{ data: any[] }>(`/api/table/${encodeURIComponent(table)}${q(filters, fields, start)}`)).data
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}
const exists = async (table: string, id: string) => (await raw(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, { token: admin })).ok

/** Writes the rows whose ids are missing, a few at a time. */
async function keepAll(table: string, rows: Record<string, unknown>[], idOf: (row: Record<string, unknown>) => string) {
  const have = new Set((await list(table, [], ['row_id'])).map(r => String(r.row_id)))
  const missing = rows.filter(row => !have.has(idOf(row)))
  for (let i = 0; i < missing.length; i += 8) await Promise.all(missing.slice(i, i + 8).map(row => save(table, row)))
  return missing.length
}

// Refuse a real instance: every person here must be on a reserved domain or be the Administrator.
const people = await list('Person', [], ['row_id', 'email'])
const real = people.filter(p => p.row_id !== 'Administrator' && p.email && !/@[\w.-]+\.(example|test|invalid)$/i.test(String(p.email)))
if (real.length) throw new Error(`Refusing: ${real.length} person(s) here have an address off the reserved example domains; this is not a demo instance`)

const apps = await call<{ installed: { name: string; enabled: boolean; version?: string; package_version?: string }[] }>('/api/apps')
for (const name of ['dash', 'tasker', 'tickets']) {
  const app = apps.installed.find(a => a.name === name && a.enabled)
  if (!app) throw new Error(`${name} must be installed and enabled first (the deploy installs it)`)
  versions[name] = String(app.package_version ?? app.version ?? '')
}

const group = banyan()
const done: string[] = []

// 1. The core Tables and who reads and edits them.
for (const table of DEMO_TABLES)
  if (!(await raw(`/api/table/${encodeURIComponent(table.name)}:meta`, { token: admin })).ok) await post('/api/table_def', table)
for (const role of ['Banyan Staff', 'Master Data Editor']) if (!(await exists('Role', role))) await save('Role', { row_id: role })
const perms = await list('Permission', [], ['ref_table', 'role', 'operation'])
const has = (ref_table: string, role: string, operation: string) => perms.some(p => p.ref_table === ref_table && p.role === role && p.operation === operation)
for (const { name } of DEMO_TABLES) {
  if (!has(name, 'Banyan Staff', 'read')) await save('Permission', { ref_table: name, role: 'Banyan Staff', operation: 'read', scope_mode: 'all' })
  for (const operation of ['create', 'update'])
    if (!has(name, 'Master Data Editor', operation)) await save('Permission', { ref_table: name, role: 'Master Data Editor', operation, scope_mode: 'all' })
}

// 2. The rows, parents first.
const idOf: Record<string, (row: any) => string> = {
  State: r => r.state, 'Operating Region': r => r.region, City: r => r.city, Cluster: r => r.code, Site: r => r.code, Plant: r => r.plant_code,
  Department: r => r.department, Designation: r => r.designation, Employee: r => r.employee_code, Employment: r => r.employment_id,
  'Job Assignment': r => r.assignment_id, 'Section Subcategory': r => r.section_subcategory_id,
}
for (const { name } of DEMO_TABLES) {
  const written = await keepAll(name, group[name], idOf[name] ?? (r => r.row_id))
  done.push(`${name}: ${group[name].length} rows (${written} new)`)
}

// 3. People who sign in. Each demo login is one employee, with the login's address as work email.
const LOGINS: Record<string, { email: string; find: (j: any) => boolean; roles: string[]; says: string }> = {
  store_manager: { email: `store.manager@${EMAIL_DOMAIN}`, find: j => j.job === 'Store Manager' && j.site === 'BMG', roles: ['Dash Section Reviewer'], says: 'Store Manager, Banyan Mangaluru' },
  team_leader: { email: `team.leader@${EMAIL_DOMAIN}`, find: j => j.job === 'Team Leader' && j.section === 'BMG-GF-Silk Sarees', roles: ['Dash Section Editor'], says: 'Team Leader, Silk and Cotton Sarees, Banyan Mangaluru' },
  floor_manager: { email: `floor.manager@${EMAIL_DOMAIN}`, find: j => j.job === 'Floor Manager' && j.acting, roles: [], says: 'Team Leader acting as Floor Manager, Banyan Mysuru first floor' },
  cluster_manager: { email: `cluster.manager@${EMAIL_DOMAIN}`, find: j => j.job === 'Cluster Manager' && j.site === 'BMG', roles: [], says: 'Cluster Manager, Coast (Mangaluru and Udupi)' },
  hr: { email: `hr@${EMAIL_DOMAIN}`, find: j => j.job === 'Head office staff' && group.Employment.some(e => e.employee === j.employee && e.designation === 'HR Manager'),
    roles: ['Master Data Editor', 'Report Access Manager', 'Tickets Support'], says: 'HR Manager: edits the core Tables, gives reports, answers tickets' },
  it: { email: `it@${EMAIL_DOMAIN}`, find: j => j.job === 'Head office staff' && group.Employment.some(e => e.employee === j.employee && e.designation === 'IT Executive'), roles: ['Tickets Support'], says: 'IT Executive: answers IT tickets' },
  warehouse: { email: `warehouse@${EMAIL_DOMAIN}`, find: j => j.site === 'BWH' && j.job === 'Head office staff', roles: [], says: 'Warehouse In-charge, Central Warehouse' },
}
const EVERYONE = ['Dash Reader', 'Banyan Staff', 'Tasker Member']
const settings = (await call<any>('/api/table/System%20Settings/System%20Settings').catch(() => ({}))) ?? {}
const everyone = new Set(String(settings.everyone_roles ?? '').split('\n').map(s => s.trim()).filter(Boolean))
if (EVERYONE.some(r => !everyone.has(r))) await save('System Settings', { everyone_roles: [...new Set([...everyone, ...EVERYONE])].join('\n') })

const personOf: Record<string, string> = {}
for (const [key, login] of Object.entries(LOGINS)) {
  const job = group['Job Assignment'].find(login.find)
  if (!job) throw new Error(`No employee fits the ${key} login`)
  const employee = group.Employee.find(e => e.employee_code === job.employee)!
  const [found] = await list('Person', [['email', '=', login.email]], ['row_id'])
  const id = found ? String(found.row_id)
    : String((await post('/api/table/Person', { email: login.email, full_name: employee.name, enabled: true, roles: login.roles.map(role => ({ role })) })).row_id)
  const person = await call<any>(`/api/table/Person/${encodeURIComponent(id)}`)
  const held = new Set((person.roles ?? []).map((r: any) => r.role))
  if (login.roles.some(role => !held.has(role)))
    await save('Person', { row_id: id, updated_at: person.updated_at, roles: [...person.roles, ...login.roles.filter(role => !held.has(role)).map(role => ({ role }))] })
  await post('/api/set_password', { user: id, password: DEMO_PASSWORD })
  personOf[key] = id
  const row = await call<any>(`/api/table/Employee/${encodeURIComponent(employee.employee_code)}`)
  if (row.person !== id || row.work_email !== login.email) await save('Employee', { row_id: row.row_id, updated_at: row.updated_at, person: id, work_email: login.email })
}

// 4. Dash: its Tables, one report with the quick view, given to every reader.
const app = (name: string) => ({ app: name })
const setting = async (row_id: string, value: string) => {
  const [found] = await list('App Setting', [['row_id', '=', row_id]], ['row_id', 'value', 'updated_at'])
  if (!found) await save('App Setting', { row_id, value })
  else if (found.value !== value) await save('App Setting', { row_id, updated_at: found.updated_at, value })
}
await setting('dash.linked_tables', JSON.stringify(LINKED_TABLES))
if (!(await exists('dash.report', 'sales')))
  await save('dash.report', { report_key: 'sales', report_name: 'Sales versus target', dive_id: 'demo-no-dive', filter_shape: 'One store and subcategories',
    store_key: 'plant_code', subcategory_key: 'material_groups', whole_store_key: 'whole_store', month_key: 'period_end', ready_signal: false, quick_view: 'Sales target' })
const bundles = await list('dash.report_bundle', [['bundle_name', '=', 'Store reports']])
const bundle = bundles[0]?.row_id ?? (await save('dash.report_bundle', { bundle_name: 'Store reports', notes: 'Every demo report, for everyone' })).row_id
if (!(await list('dash.report_bundle_member', [['report_bundle', '=', bundle]])).length) await save('dash.report_bundle_member', { report_bundle: bundle, report: 'sales' })
if (!(await list('dash.report_access', [['report_bundle', '=', bundle]])).length) await save('dash.report_access', { report_bundle: bundle, role: 'Dash Reader' })
// The warehouse the `motherduck` source reads. Built here only on this machine, where the seed sees
// the server's folder; on dev it is built inside the container (instance.md).
if (local) {
  if (!process.env.DEMO_WAREHOUSE_DIR) throw new Error('Set DEMO_WAREHOUSE_DIR in .env.local to a folder for the demo warehouse')
  const { buildWarehouse } = await import('./warehouse.mjs')
  done.push(`Warehouse: ${(await buildWarehouse(process.env.DEMO_WAREHOUSE_DIR, group)).targetRows} made-up daily target rows`)
}
// Fill Dash's copies now rather than at the next scheduled refresh.
await post('/api/enqueue_job', { method: 'refresh_datasets' })
done.push('Dash: the sales report, given to every reader; a dataset refresh queued')

// 5. Tasker.
const tokens: Record<string, string> = {}
const as = async (key: string) => (tokens[key] ??= await signIn(LOGINS[key].email, DEMO_PASSWORD))
for (const [row_id, store_name, store_type, manager] of TASKER.stores)
  if (!(await exists('tasker.store', row_id))) await create('tasker.store', { row_id, store_name, store_type, ...(manager ? { store_manager: personOf[manager] } : {}) })
for (const [row_id, project_name, description, verifier] of TASKER.projects)
  if (!(await exists('tasker.project', row_id))) await create('tasker.project', { row_id, project_name, description, ...(verifier ? { default_verifier: personOf[verifier] } : {}) })
for (const [id, task_title, project, store, state, assignee, start, due, extra] of TASKER.tasks as any[]) {
  const row_id = `DEMO-TASK-${id}`
  const { explanation, comments = [], verifier, evidence_note, ...rest } = extra
  if (!(await exists('tasker.task', row_id))) {
  // A verified task walks Tasker's own path: submitted with evidence, then closed by its verifier.
  const checker = verifier ?? (project ? TASKER.projects.find(p => p[0] === `DEMO-PROJECT-${project}`)![3] ?? null : null)
  const verified = state === 'Done' && !!checker
  const submitted = state === 'Submitted for verification' || verified
  let task = await create('tasker.task', { row_id, task_title, ...(project ? { project: `DEMO-PROJECT-${project}` } : {}), ...(store ? { store: `DEMO-STORE-${store}` } : {}),
    assigned_to: personOf[assignee], start_date: day(start), due_date: day(due), task_state: submitted ? 'In progress' : state,
    is_done: state === 'Done' && !verified, ...(verifier ? { verifier: personOf[verifier] } : {}), ...rest })
  if (submitted) task = await save('tasker.task', { row_id, updated_at: task.updated_at, task_state: 'Submitted for verification', evidence_note }, await as(assignee))
  if (verified) await save('tasker.task', { row_id, updated_at: task.updated_at, task_state: 'Done', is_done: true }, await as(checker))
  }
  for (const content of [...(explanation ? [explanation] : []), ...comments])
    if (!(await list('Comment', [['ref_table', '=', 'tasker.task'], ['ref_name', '=', row_id], ['content', '=', content]])).length)
      await save('Comment', { ref_table: 'tasker.task', ref_name: row_id, content })
}
done.push(`Tasker: ${TASKER.stores.length} stores, ${TASKER.projects.length} projects, ${TASKER.tasks.length} tasks`)

// 6. Tickets: support, types, then each ticket raised by its person and triaged by support.
await setting('tickets.linked_tables', JSON.stringify(['Site']))
await setting('tickets.support_users', JSON.stringify([personOf.hr, personOf.it]))
await setting('tickets.assignees', JSON.stringify(Object.values(personOf)))
for (const t of TICKET_TYPES) {
  const [found] = await list('tickets.ticket_type', [['type_key', '=', t.type_key]])
  const typeId = found?.row_id ?? (await save('tickets.ticket_type', { type_key: t.type_key, label: t.label, enabled: true, states: t.states.join('\n'),
    done_states: t.done.join('\n'), details_visible_to: t.visible })).row_id
  for (const [i, [field_name, label, field_type, choices, link_table, link_label, required]] of (t.fields as any[]).entries())
    if (!(await list('tickets.type_field', [['ticket_type', '=', typeId], ['field_name', '=', field_name]])).length)
      await save('tickets.type_field', { ticket_type: typeId, field_name, label, field_type, choices: choices || null, link_table: link_table || null, link_label: link_label || null, required, field_order: i + 1 })
}
const action = async (name: string, payload: object, token: string) =>
  (await post(`/api/app_actions/tickets/${name}`, { idempotencyKey: crypto.randomUUID(), payload }, token, 'tickets')).result as { ticket: any }
const raised = new Set((await list('tickets.ticket', [], ['title'])).map(t => String(t.title)))
for (const [, raiser, kind, title, original, details, then, notes] of TICKETS as any[]) {
  if (raised.has(title)) continue
  let { ticket } = await action('create', { title, original, kind, details }, await as(raiser))
  for (const text of notes) ({ ticket } = await action('note', { row_id: ticket.row_id, updated_at: ticket.updated_at, text }, await as('hr')))
  if (then) {
    const [state, assignee, public_update] = then
    ;({ ticket } = await action('edit', { row_id: ticket.row_id, updated_at: ticket.updated_at, state, assigned_to: personOf[assignee],
      ...(public_update ? { public_update } : {}) }, await as(kind === 'it_help' ? 'it' : 'hr')))
  }
}
done.push(`Tickets: ${TICKET_TYPES.length} ticket types, ${TICKETS.length} tickets`)

console.log(['Banyan Retail demo loaded. Nothing here is real.', ...done.map(d => `  ${d}`), '',
  `Sign in at ${api}/featherbase/login, password ${DEMO_PASSWORD}:`,
  ...Object.values(LOGINS).map(l => `  ${l.email.padEnd(32)} ${l.says}`)].join('\n'))
process.exit(0)
