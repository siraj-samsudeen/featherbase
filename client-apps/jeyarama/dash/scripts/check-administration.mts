// Public-API walkthrough for the disposable --made-up-data instance.
// Uses no server imports, database connection, or Administrator bypass.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const api = process.env.FEATHERBASE_API_URL
const password = process.env.FEATHERBASE_DEMO_PASSWORD
if (!api || !password) throw new Error('Set FEATHERBASE_API_URL and FEATHERBASE_DEMO_PASSWORD for the made-up instance')
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
type Row = Record<string, any>
async function login(key: string) {
  const response = await fetch(`${api}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: `reader-${key}@example.test`, pwd: password }) })
  assert.equal(response.status, 200, `Login ${key}`)
  const session = await response.json() as { token: string; user: { row_id: string } }
  return {
    person: session.user.row_id,
    async call(path: string, method = 'GET', body?: unknown, status = path === '/api/save_row' ? 201 : 200): Promise<Row> {
      const response = await fetch(`${api}${path}`, { method, headers: { 'content-type': 'application/json',
        authorization: `Bearer ${session.token}`, 'X-Featherbase-App-Version': `feather_dash@${version}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const result = await response.json() as Row
      assert.equal(response.status, status, `${key}: ${method} ${path}: ${JSON.stringify(result)}`)
      return result
    },
  }
}
const store = await login('sm')
const department = await login('dm2')
const section = await login('one')
const staff = await login('staff1')
const fields = encodeURIComponent(JSON.stringify(['row_id', 'store', 'section', 'subcategory']))
const mappings = `/api/table/feather_dash.section_subcategory`
const [all, deptRows, sectionRows] = await Promise.all([store, department, section].map(actor => actor.call(`${mappings}?fields=${fields}`)))
assert(all.total > deptRows.total)
assert.equal(deptRows.total, 2)
assert.equal(sectionRows.total, 2)
assert(all.data.every((row: Row) => row.store === '9901'))
assert(sectionRows.data.every((row: Row) => row.section === sectionRows.data[0].section))
await section.call(`${mappings}/${deptRows.data[0].row_id}`, 'GET', undefined, 403)
console.log('PASS: Store, Department and Section Managers list only their organisational mappings')

const created = await section.call('/api/save_row', 'POST', { table: 'feather_dash.section_subcategory', row: {
  store: '9901', section: sectionRows.data[0].section, subcategory: '999999991', starts_on: '2026-01-01',
} })
await section.call(`${mappings}/${created.row_id}?updated_at=${encodeURIComponent(created.updated_at)}`, 'DELETE')
const mapping = await section.call(`${mappings}/${sectionRows.data[0].row_id}`)
try {
  await section.call('/api/save_row', 'POST', { table: 'feather_dash.section_subcategory', row: {
    row_id: mapping.row_id, updated_at: mapping.updated_at, section: deptRows.data[0].section,
  } }, 403)
  const changed = await store.call('/api/save_row', 'POST', { table: 'feather_dash.section_subcategory', row: {
    row_id: mapping.row_id, updated_at: mapping.updated_at, section: deptRows.data[0].section,
  } })
  assert.equal(changed.section, deptRows.data[0].section)
  await section.call(`${mappings}/${mapping.row_id}`, 'GET', undefined, 403)
  console.log('PASS: Section Manager creates within its section; only Store Manager can move it across sections')
} finally {
  const current = await store.call(`${mappings}/${mapping.row_id}`)
  await store.call('/api/save_row', 'POST', { table: 'feather_dash.section_subcategory', row: {
    row_id: mapping.row_id, updated_at: current.updated_at, section: mapping.section,
  } })
}

const contacts = '/api/table/feather_dash.employee'
const contactFields = encodeURIComponent(JSON.stringify(['row_id', 'employee_number', 'phone']))
const own = await staff.call(`${contacts}?fields=${contactFields}`)
assert.equal(own.data.length, 1)
const contactId = own.data[0].row_id
await section.call(`${contacts}/${contactId}`, 'GET', undefined, 403)
const assignment = await store.call('/api/administration/grant', 'POST', { app: 'feather_dash',
  person: section.person, role: 'Employee Contact Admin', scope: 'demo-section-sarees' }, 201)
try {
  const original = await section.call(`${contacts}/${contactId}`)
  await section.call('/api/save_row', 'POST', { table: 'feather_dash.employee', row: {
    row_id: contactId, updated_at: original.updated_at, employee_number: 'forbidden', phone: 'must-not-save',
  } }, 403)
  const held = await section.call('/api/save_row', 'POST', { table: 'feather_dash.employee', row: {
    row_id: contactId, updated_at: original.updated_at, phone: 'demo-reviewed-correction',
  } }, 202)
  assert.equal(held.outcome, 'pending_approval')
  assert.equal((await store.call(`${contacts}/${contactId}`)).phone, original.phone)
  const decision = { proposal: held.proposal, version: held.version, decision: 'approve' }
  await section.call('/api/administration/review', 'POST', decision, 403)
  assert.equal((await store.call('/api/administration/review', 'POST', decision)).outcome, 'applied')
  const applied = await store.call(`${contacts}/${contactId}`)
  assert.equal(applied.phone, 'demo-reviewed-correction')
  await store.call('/api/save_row', 'POST', { table: 'feather_dash.employee', row: {
    row_id: contactId, updated_at: applied.updated_at, phone: original.phone,
  } })
  console.log('PASS: Bounded contact grant, forbidden-column refusal, held correction and independent approval')
} finally {
  await store.call('/api/administration/revoke', 'POST', { assignment: assignment.row_id })
}
await section.call(`${contacts}/${contactId}`, 'GET', undefined, 403)
console.log('PASS: Revocation removes delegated access; synthetic contact and mapping values restored')
