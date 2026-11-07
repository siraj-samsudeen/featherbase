// Development sample data for the Assets app: Jeyarama's places, about twenty
// assets, two people and a few repair jobs. Safe to run again: it finds what it
// made before by name. Development only.
//
//   node client-apps/jeyarama/equipment/development/seed.mjs --url=http://127.0.0.1:8000
import { readFile } from 'node:fs/promises'

const arg = (name) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
const origin = arg('--url') ?? process.env.FEATHERBASE_URL ?? 'http://127.0.0.1:8000'
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
let token = ''

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `equipment@${version}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${result.error?.message ?? JSON.stringify(result)}`)
  return result
}
const query = (filters, fields) => `?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}`

const identity = await request('/api/ping')
if (identity.environment !== 'development') throw new Error(`Assets seed runs only on a development instance, not '${identity.environment}'`)
if (identity.database_server_local !== true) throw new Error('Assets seed refuses a remote PostgreSQL server')
token = (await request('/api/login', { method: 'POST', body: { usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' } })).token

async function ensure(table, key, value, row) {
  const found = (await request(`/api/table/${encodeURIComponent(table)}${query([[key, '=', value]], ['row_id', 'updated_at'])}`)).data
  return found[0] ?? request('/api/save_row', { method: 'POST', body: { table, row } })
}
async function withRole(personId, role) {
  const person = await request(`/api/table/Person/${encodeURIComponent(personId)}`)
  if (!person.roles.some((row) => row.role === role))
    await request('/api/save_row', { method: 'POST', body: { table: 'Person', row: { row_id: person.row_id, updated_at: person.updated_at, roles: [...person.roles, { role }] } } })
}

await withRole('Administrator', 'Assets Manager')
const ravi = await ensure('Person', 'email', 'ravi.technician@example.test', { email: 'ravi.technician@example.test', full_name: 'Ravi (technician)', enabled: true })
await withRole(ravi.row_id, 'Assets Technician')
const staff = await ensure('Person', 'email', 'avadi.staff@example.test', { email: 'avadi.staff@example.test', full_name: 'Avadi store staff', enabled: true })
await withRole(staff.row_id, 'Assets Member')

const places = {}
for (const [name, type] of [
  ['Avadi Store', 'Store'], ['Keelkattalai Store', 'Store'], ['Madhavaram Store', 'Store'], ['Pallaikaranai Store', 'Store'],
  ['Tambaram Store', 'Store'], ['Kaniyapuram Store', 'Store'], ['Manimangalam WH', 'Warehouse'], ['Kattarapakkam WH', 'Warehouse'],
  ['Jeyarama Corporate Office', 'Office'],
]) places[name] = (await ensure('equipment.place', 'place_name', name, { place_name: name, place_type: type })).row_id

const types = {}
for (const name of ['AC', 'Cold room', 'Generator', 'POS terminal', 'Fixture', 'Vehicle', 'Other'])
  types[name] = (await ensure('equipment.asset_type', 'type_name', name, { type_name: name })).row_id

const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10) }
const assets = {}
for (const [name, type, place, area, make, model, serial, bought, cost, warranty] of [
  ['Voltas 2-ton split AC', 'AC', 'Avadi Store', 'Billing area', 'Voltas', '243V DZX', 'VT24-118230', '2024-03-12', 52500, '2027-03-12'],
  ['Billing PC, till 3', 'POS terminal', 'Avadi Store', 'Till 3', 'HP', 'ProDesk 400', 'HP4-99812', '2023-06-01', 41800, day(12)],
  ['Display chiller 1', 'Cold room', 'Avadi Store', 'Dairy aisle', 'Western', 'SRC 450', 'WS-450-2211', '2022-09-20', 68000, '2026-09-20'],
  ['Weighing scale 2', 'Other', 'Avadi Store', 'Vegetables', 'Essae', 'DS-852', 'ES852-7781', '2025-01-10', 9200, '2027-01-10'],
  ['Blue Star walk-in cold room', 'Cold room', 'Keelkattalai Store', 'Back store', 'Blue Star', 'WICR 8x10', 'BS-WI-5521', '2023-02-14', 385000, '2027-02-14'],
  ['Daikin 1.5-ton split AC', 'AC', 'Keelkattalai Store', 'Ladies wear', 'Daikin', 'FTKF50', 'DK-50-33190', '2024-05-02', 46900, '2029-05-02'],
  ['Billing PC, till 1', 'POS terminal', 'Keelkattalai Store', 'Till 1', 'Dell', 'OptiPlex 3000', 'DL3K-1188', '2024-08-19', 44500, '2027-08-19'],
  ['Gondola shelving, aisle 4', 'Fixture', 'Keelkattalai Store', 'Aisle 4', 'Kwality Racks', 'GR-5', null, '2021-11-05', 18500, null],
  ['Carrier 2-ton cassette AC', 'AC', 'Madhavaram Store', 'Entrance', 'Carrier', 'Cassette 24K', 'CR-24K-6610', '2022-04-28', 78000, day(25)],
  ['Billing PC, till 2', 'POS terminal', 'Madhavaram Store', 'Till 2', 'Lenovo', 'ThinkCentre M70', 'LN70-55120', '2025-02-11', 47200, '2028-02-11'],
  ['Kirloskar 62.5 kVA DG', 'Generator', 'Pallaikaranai Store', 'Terrace', 'Kirloskar', 'KG1-62.5AS', 'KOEL-62-30419', '2021-07-15', 845000, day(23)],
  ['Voltas 1.5-ton split AC', 'AC', 'Pallaikaranai Store', 'Office', 'Voltas', '183V CZZ', 'VT18-44102', '2023-10-03', 38900, '2026-10-03'],
  ['Visi cooler 2-door', 'Cold room', 'Tambaram Store', 'Beverages', 'Rockwell', 'FGVC-1000', 'RW-1000-8812', '2024-12-01', 72000, '2026-12-01'],
  ['Billing PC, till 1', 'POS terminal', 'Tambaram Store', 'Till 1', 'HP', 'ProDesk 400', 'HP4-10233', '2023-06-01', 41800, '2026-06-01'],
  ['Mahindra Supro delivery van', 'Vehicle', 'Kaniyapuram Store', 'Parking', 'Mahindra', 'Supro Cargo', 'TN 20 BX 4471', '2023-01-20', 685000, '2026-01-20'],
  ['Cummins 125 kVA DG', 'Generator', 'Manimangalam WH', 'Yard', 'Cummins', 'C125D5', 'CU-125-77810', '2020-11-30', 1420000, '2025-11-30'],
  ['Godrej electric forklift', 'Vehicle', 'Manimangalam WH', 'Dock 2', 'Godrej', 'GX 300E', 'GD-300E-1902', '2022-03-08', 1250000, day(-10)],
  ['Cold storage room 2', 'Cold room', 'Manimangalam WH', 'Cold chain', 'Blue Star', 'WICR 12x16', 'BS-WI-9912', '2021-06-18', 920000, '2026-06-18'],
  ['Pallet racking, bay A', 'Fixture', 'Kattarapakkam WH', 'Bay A', 'Godrej', 'Selective 6m', null, '2021-02-10', 260000, null],
  ['Server rack and UPS', 'Other', 'Jeyarama Corporate Office', 'Server room', 'APC', 'Smart-UPS 3kVA', 'APC3K-55129', '2024-04-04', 98000, '2027-04-04'],
]) {
  assets[`${name}|${place}`] = (await ensure('equipment.asset', 'serial_no', serial ?? `${name}|${place}`, {
    asset_name: name, asset_type: types[type], place: places[place], area, make, model, serial_no: serial ?? `${name}|${place}`,
    purchase_date: bought, purchase_cost: cost, ...(warranty ? { warranty_until: warranty } : {}),
  })).row_id
}

async function job(asset, problem, priority, after = {}) {
  const found = (await request(`/api/table/equipment.job${query([['asset', '=', asset], ['problem', '=', problem]], ['row_id'])}`)).data
  if (found.length) return
  let row = await request('/api/save_row', { method: 'POST', body: { table: 'equipment.job', row: { asset, problem, priority } } })
  for (const change of [after.assign ? { assigned_to: after.assign } : null, after.stage ? { job_state: after.stage, ...(after.fix ?? {}) } : null].filter(Boolean))
    row = await request('/api/save_row', { method: 'POST', body: { table: 'equipment.job', row: { row_id: row.row_id, updated_at: row.updated_at, ...change } } })
}
await job(assets['Voltas 2-ton split AC|Avadi Store'], 'Not cooling', 'Urgent')
await job(assets['Blue Star walk-in cold room|Keelkattalai Store'], 'Door seal torn', 'High', { assign: ravi.row_id })
await job(assets['Kirloskar 62.5 kVA DG|Pallaikaranai Store'], 'Battery weak, slow to start', 'Normal', { assign: ravi.row_id, stage: 'Waiting for parts' })
await job(assets['Billing PC, till 2|Madhavaram Store'], 'Receipt printer jams', 'High', { assign: ravi.row_id, stage: 'In progress' })
await job(assets['Billing PC, till 3|Avadi Store'], 'Keyboard keys stuck', 'Normal', { assign: ravi.row_id, stage: 'Fixed', fix: { work_done: 'Replaced the keyboard', repair_cost: 650 } })

console.log(`Assets sample data ready at ${origin}/equipment/ (${Object.keys(places).length} places, ${Object.keys(assets).length} assets)`)
