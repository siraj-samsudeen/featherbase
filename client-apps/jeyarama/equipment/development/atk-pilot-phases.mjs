// The ATK 1501 asset pilot's seven phases as a Tasker project: one dated task per phase, with
// what happens, its output and who signs it off (ATK 1501 Asset Inventory and Tagging Plan,
// 7-Nov-2026). Days count from the count day D1 and are calendar days; re-plan once the store
// walk gives a real asset count. Safe to run again: it finds the project by name.
//
//   node client-apps/jeyarama/equipment/development/atk-pilot-phases.mjs --url=http://127.0.0.1:8000 --d1=2026-12-01
const arg = (name) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
const origin = arg('--url') ?? process.env.FEATHERBASE_URL ?? 'http://127.0.0.1:8000'
const d1 = arg('--d1') ?? (() => { const d = new Date(); d.setDate(d.getDate() + 10); return d.toISOString().slice(0, 10) })()
if (!/^\d{4}-\d{2}-\d{2}$/.test(d1)) throw new Error('Give the count day as --d1=YYYY-MM-DD')

let token = ''
let version = ''
async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(version ? { 'X-Featherbase-App-Version': version } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${result.error?.message ?? JSON.stringify(result)}`)
  return result
}
const query = (filters, fields) => `?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}`
// D1 is the count day itself, D-1 the day before it: there is no D0.
const day = (n) => { const d = new Date(`${d1}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + (n > 0 ? n - 1 : n)); return d.toISOString().slice(0, 10) }

token = (await request('/api/login', { method: 'POST', body: { usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' } })).token
version = (await request('/api/runtime_app_versions')).find((v) => v.startsWith('tasker@'))
if (!version) throw new Error('Tasker is not installed on this instance')

const PHASES = [
  ['0 Mobilise', -10, -6, 'Approve scope and dates, name the team, order labels and the printer, and request the SAP book extract for plant 1501.', 'Approved plan and team list', 'Sponsor and entity finance controller'],
  ['1 Prepare', -5, -1, 'Walk the store, fix area codes and the floor plan, print numbered tags, train the count teams, and announce the movement freeze.', 'Location codes, tag rolls, trained teams', 'Site manager'],
  ['2 Count and tag', 1, 3, 'Blind count area by area: tag, photograph and record every item; close each day with a line count. No asset leaves or enters ATK without the site manager’s written note.', 'Filled count sheet and photos', 'Count lead, and the site manager daily'],
  ['3 Independent check', 4, 4, 'Recount a 10% sample plus every item over the value threshold Finance sets.', 'Recount result and error rate', 'Internal Audit or Loss Prevention'],
  ['4 Match to SAP', 4, 8, 'The asset accountant matches each SAP record to a tag; the reconciliation fills.', 'Matched SAP extract and summary', 'Asset accountant, reviewed by the finance controller'],
  ['5 Investigate and decide', 8, 15, 'Search for what was not found; decide on items found but not in the books, damaged and idle.', 'Exceptions log with an approval for each line', 'Entity finance controller'],
  ['6 Update SAP', 15, 20, 'The SAP team updates the asset master, creates approved new assets and retires approved losses.', 'SAP change log', 'SAP owner and finance controller'],
  ['7 Close', 20, 22, 'Load the tagged register into Featherbase Assets with SAP numbers; write the pilot report and lessons for rollout.', 'Signed pilot report', 'Finance, Operations, Engineering and IT; Internal Audit reviews'],
]

const ensure = async (table, key, value, row) =>
  (await request(`/api/table/${encodeURIComponent(table)}${query([[key, '=', value]], ['row_id'])}`)).data[0] ?? request('/api/save_row', { method: 'POST', body: { table, row } })
const store = await ensure('tasker.store', 'store_name', 'ATK 1501', { store_name: 'ATK 1501', store_type: 'Store' })
const project = await ensure('tasker.project', 'project_name', 'ATK 1501 asset pilot', {
  project_name: 'ATK 1501 asset pilot',
  description: `Count every asset at ATK 1501 fresh, tag it with a permanent JRA number, match the count to the SAP book, and have the SAP team update SAP. Count day (D1): ${d1}. Each phase's sign-off person should be set as the task's verifier.`,
})
let made = 0
for (const [title, from, to, what, output, signOff] of PHASES) {
  const existing = (await request(`/api/table/tasker.task${query([['project', '=', project.row_id], ['task_title', '=', `Phase ${title}`]], ['row_id'])}`)).data
  if (existing.length) continue
  await request('/api/save_row', { method: 'POST', body: { table: 'tasker.task', row: {
    task_title: `Phase ${title}`, project: project.row_id, store: store.row_id, start_date: day(from), due_date: day(to),
    description: `${what}\n\n**Output:** ${output}\n\n**Sign-off:** ${signOff}`,
  } } })
  made++
}
console.log(`ATK 1501 asset pilot ready in Tasker (${made} phase tasks added; D1 is ${d1})`)
