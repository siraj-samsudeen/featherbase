import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

// Explicit walkthrough setup, never called by installation or ordinary startup.
export async function seedTickets({ baseUrl, password = 'admin', expectedEnvironment = 'development' }) {
  const origin = new URL(baseUrl)
  assert(['http:', 'https:'].includes(origin.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'Tickets samples require a loopback destination')
  assert(['development', 'test'].includes(expectedEnvironment), 'Tickets samples require development or test')
  let token
  async function api(path, body) {
    const response = await fetch(new URL(path, origin), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': 'tickets@0.1.0', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const result = await response.json()
    if (!response.ok) throw Error(`${path}: ${response.status} ${result.error?.message ?? 'Request failed'}`)
    return result
  }
  const identity = await api('/api/ping')
  assert(identity.environment === expectedEnvironment && identity.database_server_local === true, 'Tickets samples refuse a non-local database or unexpected environment')
  token = (await api('/api/login', { usr: 'Administrator', pwd: password })).token
  const adminToken = token
  const admin = (await api('/api/whoami')).row_id
  const read = async (name, payload = {}) => (await api(`/api/app_reads/tickets/${name}`, { payload })).result.answer
  const action = async (name, payload, key) => (await api(`/api/app_actions/tickets/${name}`, { idempotencyKey: key, payload })).result
  const before = (await read('queue')).tickets
  if (before.length) {
    assert(before.every(ticket => ticket.title.startsWith('[Fictional]')), 'Tickets samples refuse a queue containing real requests')
    return { existing: true, count: before.length }
  }
  const people = {}
  const demoPassword = ['Tickets', 'Demo', '810!'].join('-')
  for (const [name, staff] of [['Anjali', false], ['Bala', true], ['Siraj', true], ['Shahul', true], ['Karthik', true], ['Shiva', true]]) {
    const email = `${name.toLowerCase()}@tickets.example.test`
    const params = new URLSearchParams({ filters: JSON.stringify([['email', '=', email]]), fields: JSON.stringify(['row_id', 'full_name']) })
    const existing = (await api(`/api/table/Person?${params}`)).data[0]
    assert(!existing || existing.full_name === `${name} (fictional)`, 'Sample account collides with an existing person')
    const person = existing ?? await api('/api/save_row', { table: 'Person', row: { email, full_name: `${name} (fictional)`, enabled: true, roles: staff ? [{ role: 'Tickets Support' }] : [] } })
    if (!existing) await api('/api/set_password', { user: person.row_id, password: demoPassword })
    people[name] = { row_id: person.row_id, email }
  }
  const config = {
    support_users: [admin, ...Object.entries(people).filter(([name]) => name !== 'Anjali').map(([, person]) => person.row_id)],
    verification_admins: [admin, ...['Bala', 'Siraj', 'Shahul'].map(name => people[name].row_id)],
    fulfillment_admins: [admin, ...['Bala', 'Siraj', 'Shahul'].map(name => people[name].row_id)],
    approval_routes: { Kerala: [people.Bala.row_id], Chennai: [people.Karthik.row_id, people.Shiva.row_id] },
    restricted_resources: ['Bronze'],
  }
  for (const [name, value] of Object.entries(config)) await api('/api/save_row', { table: 'App Setting', row: { row_id: `tickets.${name}`, value: JSON.stringify(value) } })
  const loginAs = async name => { token = name === 'Administrator' ? adminToken : (await api('/api/login', { usr: people[name].email, pwd: demoPassword })).token }
  const rows = []
  async function ticket(title, kind, details, original) {
    await loginAs('Anjali')
    const result = await action('create', { title: `[Fictional] ${title}`, kind, details, original: `FICTIONAL DEVELOPMENT SAMPLE — ${original}` }, `tickets-demo-${rows.length}`)
    rows.push(result.ticket)
    return result.ticket
  }
  const rev = ticket => ({ row_id: ticket.row_id, updated_at: ticket.updated_at })
  await ticket('MotherDuck access · Kerala', 'access', { email: 'anjali@example.com', resource: 'MotherDuck', scope: 'Gold sales, read only' }, 'Please provide Gold sales access for the month-end review.')
  let chennai = await ticket('MotherDuck access · Chennai', 'access', { email: 'anjali@example.com', resource: 'MotherDuck', scope: 'Gold sales, read only' }, 'Need read-only sales access for the Chennai store review.')
  await loginAs('Administrator')
  await action('verify', { ...rev(chennai), email: 'anjali@example.com', active: true, region: 'Chennai', evidence: 'FICTIONAL manual HR confirmation — no StyleHR lookup' }, 'tickets-demo-chennai-verify')
  let approved = await ticket('Approved · ready for manual fulfillment', 'access', { email: 'anjali@example.com', resource: 'MotherDuck', scope: 'Gold sales, read only' }, 'Please grant the approved Gold sales scope.')
  await loginAs('Administrator')
  approved = (await action('verify', { ...rev(approved), email: 'anjali@example.com', active: true, region: 'Kerala', evidence: 'FICTIONAL manual HR confirmation — no live employee data' }, 'tickets-demo-approved-verify')).ticket
  await loginAs('Bala')
  await action('decide', { ...rev(approved), decision: 'approved' }, 'tickets-demo-approved-decide')
  let bronze = await ticket('Bronze Zakya · policy review', 'access', { email: 'anjali@example.com', resource: 'Bronze Zakya', scope: 'Read invoice source tables' }, 'Can I have access to Bronze Zakya?')
  await loginAs('Administrator')
  await action('verify', { ...rev(bronze), email: 'anjali@example.com', active: true, region: 'Kerala', evidence: 'FICTIONAL manual confirmation' }, 'tickets-demo-bronze-verify')
  const stale = await ticket('Cleared Zakya invoices missing from report', 'freshness', { source: 'Zakya', model: 'Daily sales', period: '2026-11-01', expected: '2 cleared invoices', actual: '0 in report' }, 'Invoices cleared two days ago are missing from the daily report.')
  await loginAs('Administrator')
  await action('evidence', { ...rev(stale), expected: '2 source invoices', observed: '0 report invoices', reference: 'FICTIONAL source-check-1 / report-check-1', observed_at: '2026-11-03T09:00:00Z', finding: 'FICTIONAL mismatch for the walkthrough; not a production finding' }, 'tickets-demo-evidence')
  await ticket('Need help with a report', 'generic', {}, 'Can you send the Palakkad sales report in Excel? Not sure which dates to use yet.')
  await ticket('Palakkad October sales export', 'report', { report: 'Sales: date, store, net sales', store: 'Palakkad', from: '2026-10-01', through: '2026-10-31', format: 'Excel', recipients: 'requester@example.com' }, 'Need the October sales export for the monthly review.')
  await ticket('New stock-movement source', 'source', { source: 'Example vendor API', entity: 'Stock movements', refresh: 'Hourly', purpose: 'Inventory reporting' }, 'Please add stock movements from the vendor API.')
  await ticket('Add invoice-cleared timestamp', 'schema', { model: 'Silver invoices', column: 'Cleared timestamp', definition: 'Time the source marked an invoice cleared' }, 'Please include the cleared timestamp for invoice reconciliation.')
  await ticket('SAP stock movement pipeline stopped', 'pipeline', { pipeline: 'SAP stock movements', failure: 'No new rows reported', period: 'Since 2026-11-02' }, 'The stock movement pipeline appears to have stopped. Please investigate.')
  await ticket('Historical sales backfill', 'backfill', { source: 'Example kitchen POS', from: '2026-01-01', through: '2026-03-31', scope: 'Sales' }, 'Please load the first quarter sales history.')
  return { count: rows.length, accounts: Object.fromEntries(Object.entries(people).map(([name, person]) => [name, person.email])) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const option = name => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
  const result = await seedTickets({ baseUrl: option('--url') ?? process.env.FEATHERBASE_URL ?? 'http://127.0.0.1:8110', password: process.env.ADMIN_PASSWORD ?? 'admin', expectedEnvironment: option('--expected-environment') ?? 'development' })
  console.log(`Fictional Tickets walkthrough ready (${result.count} tickets). No external integrations or grants ran.`)
}
