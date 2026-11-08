// Development sample data for the Assets app, set up for the Asset Management
// BRD's pilot: ATK 1501, Enchakkal WH 9151 and a Chennai store still to be
// chosen. Legal entity codes and every SAP number here are made up and marked
// SAMPLE; they are not the group's real records. Safe to run again: it finds
// what it made before by name. Development only.
//
//   node client-apps/jeyarama/equipment/development/seed.mjs --url=http://127.0.0.1:8000
import { readFile } from 'node:fs/promises'

const arg = (name) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
const origin = arg('--url') ?? process.env.FEATHERBASE_URL ?? 'http://127.0.0.1:8000'
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
let token = ''

async function request(path, { method = 'GET', body, as = token } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `equipment@${version}`, ...(as ? { Authorization: `Bearer ${as}` } : {}) },
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
const staff = await ensure('Person', 'email', 'atk.staff@example.test', { email: 'atk.staff@example.test', full_name: 'Suresh K (ATK store)', enabled: true })
await withRole(staff.row_id, 'Assets Member')

// Legal entities: short names from the BRD; codes are samples until Finance certifies the register.
const entities = {}
for (const [short, status, code] of [['JRPL', 'Verified', 'SAMPLE-1000'], ['KAIPL', 'Verified', 'SAMPLE-2000'], ['RRPL', 'Held', 'SAMPLE-3000']])
  entities[short] = (await ensure('equipment.entity', 'short_name', short, {
    entity_name: `${short} (sample: confirm the registered name)`, short_name: short, sap_company_code: code, entity_status: status,
  })).row_id

// Places: site › building › floor › area.
const places = {}
async function place(name, level, parent, extra = {}) {
  places[name] = (await ensure('equipment.place', 'place_name', name, { place_name: name, place_level: level, ...(parent ? { parent_place: places[parent] } : {}), ...extra })).row_id
}
await place('ATK 1501', 'Site', null, { site_kind: 'Store', sap_plant: '1501' })
await place('ATK main building', 'Building', 'ATK 1501')
await place('ATK ground floor', 'Floor', 'ATK main building')
for (const area of ['Billing', 'Dairy aisle', 'Back store']) await place(`ATK ${area}`, 'Area', 'ATK ground floor')
await place('Enchakkal WH 9151', 'Site', null, { site_kind: 'Warehouse', sap_plant: '9151' })
await place('Enchakkal main building', 'Building', 'Enchakkal WH 9151')
await place('Enchakkal ground floor', 'Floor', 'Enchakkal main building')
for (const area of ['Cold chain', 'Dispatch']) await place(`Enchakkal ${area}`, 'Area', 'Enchakkal ground floor')
await place('Chennai pilot store (to be chosen)', 'Site', null, { site_kind: 'Store' })

const types = {}
for (const name of ['AC', 'Cold room', 'Generator', 'POS terminal', 'Fixture', 'Vehicle', 'Other'])
  types[name] = (await ensure('equipment.asset_type', 'type_name', name, { type_name: name })).row_id

const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10) }
const refreshed = new Date(Date.now() - 6 * 3_600_000).toISOString()
const assets = {}
let sapNo = 1
for (const [name, type, at, owner, books, condition, custody, make, model, serial, warranty, amc] of [
  ['Voltas 2-ton split AC', 'AC', 'ATK Billing', 'JRPL', 'Capitalized', 'Working', 'At location', 'Voltas', '243V DZX', 'VT24-118230', '2027-03-12', null],
  ['Billing PC, till 3', 'POS terminal', 'ATK Billing', 'JRPL', 'Capitalized', 'Working', 'At location', 'HP', 'ProDesk 400', 'HP4-99812', day(12), null],
  ['Display chiller 1', 'Cold room', 'ATK Dairy aisle', 'JRPL', 'Fully depreciated', 'Working', 'At location', 'Western', 'SRC 450', 'WS-450-2211', '2026-09-20', ['Western Refrigeration', day(200)]],
  ['Weighing scale 2', 'Other', 'ATK Dairy aisle', 'JRPL', 'Controlled item', 'Working', 'At location', 'Essae', 'DS-852', 'ES852-7781', '2027-01-10', null],
  ['Gondola shelving, aisle 4', 'Fixture', 'ATK ground floor', 'JRPL', 'Capitalized', 'Working', 'At location', 'Kwality Racks', 'GR-5', null, null, null],
  ['Kirloskar 62.5 kVA DG', 'Generator', 'ATK main building', 'JRPL', 'Capitalized', 'Under repair', 'At location', 'Kirloskar', 'KG1-62.5AS', 'KOEL-62-30419', day(23), ['Kirloskar Service', day(300)]],
  ['EDC card terminal 2', 'POS terminal', 'ATK Billing', null, 'Leased or third party', 'Working', 'At location', 'Pine Labs', 'Plutus', 'PL-55102', null, null],
  ['Blue Star walk-in cold room', 'Cold room', 'Enchakkal Cold chain', 'KAIPL', 'Capitalized', 'Under repair', 'At location', 'Blue Star', 'WICR 12x16', 'BS-WI-9912', '2026-06-18', ['Blue Star AMC', day(240)]],
  ['Pallet racking, bay A', 'Fixture', 'Enchakkal Dispatch', 'KAIPL', 'Capitalized', 'Working', 'At location', 'Godrej', 'Selective 6m', null, null, null],
  ['Godrej electric forklift', 'Vehicle', 'Enchakkal Dispatch', 'KAIPL', 'Capitalized', 'Idle', 'At location', 'Godrej', 'GX 300E', 'GD-300E-1902', day(-10), null],
  ['Cummins 125 kVA DG', 'Generator', 'Enchakkal main building', 'KAIPL', 'Capitalized', 'Working', 'At location', 'Cummins', 'C125D5', 'CU-125-77810', '2025-11-30', null],
  ['Daikin 1.5-ton split AC', 'AC', 'Chennai pilot store (to be chosen)', 'JRPL', 'Not yet in SAP', 'Working', 'At location', 'Daikin', 'FTKF50', 'DK-50-33190', '2029-05-02', null],
]) {
  const sap = books === 'Not yet in SAP' || books === 'Leased or third party' ? {} : {
    sap_company_code: `SAMPLE-${owner === 'KAIPL' ? 2000 : 1000}`, sap_asset_no: `SAMPLE-${String(sapNo).padStart(6, '0')}`, sap_asset_sub: '0',
    sap_equipment_no: type === 'Fixture' ? null : `SAMPLE-EQ-${String(sapNo).padStart(5, '0')}`, legacy_id: `SAMPLE-OLD-${sapNo}`, sap_refreshed_at: refreshed,
  }
  sapNo += 1
  const key = serial ?? `${name}|${at}`
  assets[name] = (await ensure('equipment.asset', 'serial_no', key, {
    asset_name: name, asset_type: types[type], place: places[at], book_status: books, condition, custody_status: custody,
    ...(owner ? { owner_entity: entities[owner], operator_entity: entities[owner] } : {}),
    cost_centre: owner === 'KAIPL' ? 'SAMPLE-CC-ENC-410' : 'SAMPLE-CC-ATK-110',
    make, model, serial_no: key, ...(warranty ? { warranty_until: warranty } : {}),
    ...(amc ? { amc_vendor: amc[0], amc_until: amc[1] } : {}), ...sap,
  })).row_id
}

async function job(asset, problem, priority, after = {}) {
  const found = (await request(`/api/table/equipment.job${query([['asset', '=', asset], ['problem', '=', problem]], ['row_id'])}`)).data
  if (found.length) return found[0]
  let row = await request('/api/save_row', { method: 'POST', body: { table: 'equipment.job', row: {
    asset, problem, priority, ...(after.failedMinutesAgo ? { failure_started_at: new Date(Date.now() - after.failedMinutesAgo * 60_000).toISOString() } : {}),
  } } })
  for (const change of [after.assign ? { assigned_to: after.assign } : null, ...(after.stages ?? []).map(stage => ({ job_state: stage, ...(stage === 'Fixed' ? after.fix : {}) }))].filter(Boolean))
    row = await request('/api/save_row', { method: 'POST', body: { table: 'equipment.job', row: { row_id: row.row_id, updated_at: row.updated_at, ...change } } })
  return row
}
await job(assets['Voltas 2-ton split AC'], 'Not cooling', 'Urgent', { failedMinutesAgo: 25 })
await job(assets['Blue Star walk-in cold room'], 'Door seal torn', 'High', { assign: ravi.row_id, failedMinutesAgo: 40, stages: ['In progress', 'Waiting for parts'] })
await job(assets['Kirloskar 62.5 kVA DG'], 'Battery weak, slow to start', 'Normal', { assign: ravi.row_id, stages: ['In progress'] })
await job(assets['Billing PC, till 3'], 'Receipt printer jams', 'High', { assign: ravi.row_id, failedMinutesAgo: 30, stages: ['In progress', 'Fixed'],
  fix: { work_done: 'Cleaned and realigned the printer head', cause: 'Paper dust in the head', spares: 'Thermal roll, 2 nos.', repair_cost: 450 } })
const closed = await job(assets['Display chiller 1'], 'Not holding temperature', 'Urgent', { assign: ravi.row_id, failedMinutesAgo: 90, stages: ['In progress', 'Fixed'],
  fix: { work_done: 'Replaced the thermostat', cause: 'Faulty thermostat', spares: 'Thermostat, 1 no.', outside_service: 'Western Refrigeration AMC', repair_cost: 1850 } })
const confirmations = (await request(`/api/table/equipment.restoration${query([['job', '=', closed.row_id]], ['row_id'])}`)).data
if (!confirmations.length) await request('/api/save_row', { method: 'POST', body: { table: 'equipment.restoration', row: { job: closed.row_id, note: 'Holding 4 °C again' } } })

// A sample ATK count left in review, so a manager can open its review page. Administrator
// reviews; Suresh counts, so his records are made as him, through a short-lived token.
const countName = 'ATK full count (sample)'
const existingCount = (await request(`/api/table/equipment.count${query([['count_name', '=', countName]], ['row_id'])}`)).data
if (!existingCount.length) {
  let count = await request('/api/save_row', { method: 'POST', body: { table: 'equipment.count', row: {
    count_name: countName, scope_place: places['ATK 1501'], count_kind: 'Full', starts_on: day(-1), ends_on: day(0), reviewer: 'Administrator',
  } } })
  await request('/api/save_row', { method: 'POST', body: { table: 'equipment.counter', row: { count: count.row_id, person: staff.row_id } } })
  await request('/api/app_actions/equipment/start_count', { method: 'POST', body: { idempotencyKey: crypto.randomUUID(), payload: { row_id: count.row_id, updated_at: count.updated_at } } })
  const access = await request('/api/access_tokens', { method: 'POST', body: { label: 'Assets sample count (removed after seeding)', owner: staff.row_id, expires_at: new Date(Date.now() + 600_000).toISOString() } })
  const record = (row) => request('/api/save_row', { method: 'POST', as: access.token, body: { table: 'equipment.scan', row: { count: count.row_id, ...row } } })
  try {
    await record({ asset: assets['Voltas 2-ton split AC'], outcome: 'Found here', area: places['ATK Billing'] })
    await record({ asset: assets['Billing PC, till 3'], outcome: 'Found here', area: places['ATK Billing'] })
    await record({ asset: assets['Billing PC, till 3'], outcome: 'Found here', area: places['ATK Billing'] })
    await record({ asset: assets['Display chiller 1'], outcome: 'Damaged', condition: 'Damaged', area: places['ATK Dairy aisle'] })
    await record({ asset: assets['Gondola shelving, aisle 4'], outcome: 'Idle', area: places['ATK ground floor'] })
    await record({ asset: assets['EDC card terminal 2'], outcome: 'Belongs elsewhere', area: places['ATK Dairy aisle'] })
    await record({ typed_tag: assets['Kirloskar 62.5 kVA DG'], reason: 'Label faded by heat', outcome: 'Found here', area: places['ATK main building'] })
    await record({ outcome: 'Not on the list', description: 'Blue plastic crate stand', new_tag: 'AST-NEW-0001', reason: 'No tag found', area: places['ATK Dairy aisle'] })
  } finally {
    await request(`/api/access_tokens/${encodeURIComponent(access.id)}`, { method: 'DELETE' })
  }
  count = await request(`/api/table/equipment.count/${count.row_id}`)
  await request('/api/save_row', { method: 'POST', body: { table: 'equipment.count', row: { row_id: count.row_id, updated_at: count.updated_at, count_state: 'In review' } } })
}

// Custody and transfers (BRD step 3). Meena is a second Assets Manager, so approvals and the
// Finance confirmation come from someone other than the requester; she, Suresh and Karthik act
// through short-lived tokens that are removed afterwards.
const meena = await ensure('Person', 'email', 'meena.assets@example.test', { email: 'meena.assets@example.test', full_name: 'Meena (Assets Manager)', enabled: true })
await withRole(meena.row_id, 'Assets Manager')
const karthik = await ensure('Person', 'email', 'karthik.leaving@example.test', { email: 'karthik.leaving@example.test', full_name: 'Karthik R (leaving)', enabled: true })
await withRole(karthik.row_id, 'Assets Member')
const existingTransfers = (await request(`/api/table/equipment.transfer${query([], ['row_id'])}`)).data
if (!existingTransfers.length) {
  const tokens = []
  const tokenFor = async (person) => {
    const access = await request('/api/access_tokens', { method: 'POST', body: { label: 'Assets sample custody (removed after seeding)', owner: person, expires_at: new Date(Date.now() + 600_000).toISOString() } })
    tokens.push(access.id)
    return access.token
  }
  const save = (table, row, as) => request('/api/save_row', { method: 'POST', as, body: { table, row } })
  const act = (name, payload, as) => request(`/api/app_actions/equipment/${name}`, { method: 'POST', as, body: { idempotencyKey: crypto.randomUUID(), payload } }).then(r => r.result)
  const fresh = (table, id) => request(`/api/table/${table}/${encodeURIComponent(id)}`)
  const linesOf = async (transfer) => (await request(`/api/table/equipment.transfer_line${query([['transfer', '=', transfer]], ['row_id'])}`)).data
  const hours = (n) => new Date(Date.now() + n * 3_600_000).toISOString()
  try {
    const asMeena = await tokenFor(meena.row_id), asSuresh = await tokenFor(staff.row_id)
    const transfer = async (by, values, items) => {
      const t = await save('equipment.transfer', values, by)
      for (const asset of items) await save('equipment.transfer_line', { transfer: t.row_id, asset: assets[asset] }, by)
      return t
    }
    const approve = async (t, by) => save('equipment.transfer', { row_id: t.row_id, updated_at: (await fresh('equipment.transfer', t.row_id)).updated_at, transfer_state: 'Approved' }, by)
    const dispatch = (t, transporter, items) => act('dispatch_transfer', { transfer: t.row_id, transporter, scanned: items.map(a => assets[a]) })

    // Custody: one waiting for Suresh, one accepted, one waiting for the Administrator, and one
    // returned (so the DG's history shows both custody and a move).
    await act('issue_custody', { asset: assets['Billing PC, till 3'], person: staff.row_id, kind: 'Employee' })
    const edc = await act('issue_custody', { asset: assets['EDC card terminal 2'], person: staff.row_id, kind: 'Location custodian' })
    await save('equipment.custody', { row_id: edc.row_id, updated_at: edc.updated_at, custody_state: 'Accepted' }, asSuresh)
    await act('issue_custody', { asset: assets['Daikin 1.5-ton split AC'], person: 'Administrator', kind: 'Location custodian' })
    const dg = await act('issue_custody', { asset: assets['Cummins 125 kVA DG'], person: ravi.row_id, kind: 'Location custodian' })
    await act('return_custody', { custody: dg.row_id })

    // A leaver past the leaving date who still holds the store's AC.
    await act('issue_custody', { asset: assets['Voltas 2-ton split AC'], person: karthik.row_id, kind: 'Location custodian' })
    await save('equipment.clearance', { person: karthik.row_id, reason: 'Leaving', leaving_date: day(-3), note: 'Leaving date from HR (StyleHR feed comes later)' })

    // Overdue between sites: the scale was due at the warehouse 20 hours ago.
    const late = await transfer(undefined, { transfer_kind: 'Between sites', from_place: places['ATK 1501'], to_place: places['Enchakkal WH 9151'],
      reason: 'Spare scale for the cold chain', expected_receipt_at: hours(-20) }, ['Weighing scale 2'])
    await approve(late, asMeena)
    await dispatch(late, 'TN 09 AB 1234, Murugan Transports', ['Weighing scale 2'])

    // Waiting for approval: Meena asks to borrow the forklift, so the Administrator can approve it.
    await transfer(asMeena, { transfer_kind: 'Temporary loan', from_place: places['Enchakkal WH 9151'], to_place: places['ATK 1501'],
      reason: 'Loan the forklift for the Diwali stock unload' }, ['Godrej electric forklift'])

    // With a vendor: the cold room's compressor went to Blue Star.
    const repair = await transfer(undefined, { transfer_kind: 'Repair with vendor', from_place: places['Enchakkal WH 9151'], to_place: places['Enchakkal WH 9151'],
      vendor: 'Blue Star service centre, Ambattur', reason: 'Compressor rewinding under AMC' }, ['Blue Star walk-in cold room'])
    await approve(repair, asMeena)
    await dispatch(repair, 'Blue Star service van TN 05 CK 7781', ['Blue Star walk-in cold room'])

    // Between companies: Meena moved the DG from KAIPL to JRPL; it has arrived, and Finance's
    // SAP transaction is still to be recorded, by the Administrator.
    const sale = await transfer(asMeena, { transfer_kind: 'Between companies', from_place: places['Enchakkal WH 9151'], to_place: places['ATK 1501'],
      to_entity: entities.JRPL, reason: 'DG moves to ATK; KAIPL sells it to JRPL' }, ['Cummins 125 kVA DG'])
    await approve(sale, undefined)
    await dispatch(sale, 'TN 22 Q 4410, Sri Balaji Cranes', ['Cummins 125 kVA DG'])
    for (const line of await linesOf(sale.row_id)) await act('receive_line', { line: line.row_id, outcome: 'Received good', note: 'Unloaded by crane, no damage' })
  } finally {
    for (const id of tokens) await request(`/api/access_tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}

// ATK 1501 tagging plan (equipment 0.2.0): classes, types with stickers, tag rolls, area codes,
// Finance people, and a fresh count on its first day. The Administrator is ATK's site manager and
// the asset accountant; Meena is the Finance Controller; Suresh and Ravi are the count team.
const CLASS_TYPES = {
  'Buildings': [['Building structure', 'No sticker', false, 'Recorded by area with a photo']],
  'Leasehold improvements and fit-outs': [['Fit-out by area', 'No sticker', false, 'Recorded by area with a photo'], ['Signage', 'Metal', false, 'UV-resistant plate']],
  'Electrical installations': [['DG set', 'Metal', true, 'Plate away from the hot surface'], ['UPS and batteries', 'Standard PET', true, 'Front panel, not the battery'], ['Electrical panel', 'Standard PET', true, 'Outside the door'], ['Lighting', 'No sticker', false, 'Recorded by area']],
  'HVAC': [['Split AC', 'Metal', true, 'Indoor and outdoor units carry the same tag; top right of the indoor front panel'], ['Cassette AC', 'Standard PET', true, 'Grille edge, visible from below'], ['Ducted AC', 'Metal', true, 'Outdoor unit plate'], ['Air curtain', 'Standard PET', true, 'Right end of the casing']],
  'Refrigeration and cold chain': [['Walk-in cold room', 'Freezer-grade', true, 'Outside the door, applied at room temperature'], ['Display chiller', 'Freezer-grade', true, 'Outside the door'], ['Visi cooler', 'Freezer-grade', true, 'Side panel, outside']],
  'Furniture and fixtures': [['Gondola run', 'Standard PET', false, 'Aisle-facing end panel'], ['Racking', 'Standard PET', false, 'Upright at eye level'], ['Counter', 'Standard PET', false, 'Inside face, staff side'], ['Office furniture', 'Standard PET', false, 'Underside front edge']],
  'Retail store equipment': [['Weighing scale', 'Tamper-evident', false, 'IT supports; base, not the pan'], ['Billing printer', 'Tamper-evident', false, 'Back panel'], ['EAS gate', 'Standard PET', false, 'Inside face of the left gate'], ['Shopping trolley', 'No sticker', false, 'Bulk count, no tag'], ['Shopping basket', 'No sticker', false, 'Bulk count, no tag']],
  'Computers and IT': [['POS terminal', 'Tamper-evident', false, 'Back of the monitor'], ['PC', 'Tamper-evident', false, 'Side of the cabinet'], ['Network switch', 'Tamper-evident', false, 'Front, beside the ports'], ['Handheld scanner', 'Tamper-evident', false, 'Back, below the battery door']],
  'Office equipment': [['Printer or copier', 'Standard PET', true, 'Front top right']],
  'Security and safety systems': [['CCTV camera', 'Standard PET', false, 'Recorded with the NVR channel'], ['Fire system', 'Standard PET', true, 'Panel door'], ['Fire extinguisher', 'Standard PET', false, 'Body, below the gauge']],
  'Vehicles and material handling': [['Delivery van', 'Metal', false, 'Riveted plate inside the door frame'], ['Forklift', 'Metal', false, 'Riveted plate on the chassis'], ['Pallet truck', 'Metal', false, 'Handle plate']],
  'Kitchen and food-service': [['Oven', 'Metal', true, 'Plate away from the hot surface'], ['Fryer', 'Metal', true, 'Plate away from the hot surface'], ['Mixer', 'Standard PET', true, 'Base, front']],
}
const classes = {}, atkTypes = {}
for (const [className, list] of Object.entries(CLASS_TYPES)) {
  classes[className] = (await ensure('equipment.asset_class', 'class_name', className, { class_name: className })).row_id
  for (const [type_name, sticker, engineering_maintained, counting_note] of list)
    atkTypes[type_name] = (await ensure('equipment.asset_type', 'type_name', type_name, { type_name, asset_class: classes[className], sticker, engineering_maintained, counting_note })).row_id
}
for (const [roll_name, sticker, first_no, last_no, team] of [['Standard PET roll 1', 'Standard PET', 1, 200, 'Team A'], ['Tamper-evident roll 1', 'Tamper-evident', 201, 300, 'Team A'],
  ['Freezer-grade roll 1', 'Freezer-grade', 301, 400, 'Team B'], ['Metal labels 1', 'Metal', 401, 460, 'Team B']])
  await ensure('equipment.tag_roll', 'roll_name', roll_name, { roll_name, sticker, first_no, last_no, team, issued_on: day(0) })
const refreshPlace = (name) => request(`/api/table/equipment.place/${encodeURIComponent(places[name])}`)
for (const [name, area_code] of [['ATK Billing', 'ATK-GF-A01'], ['ATK Dairy aisle', 'ATK-GF-A02'], ['ATK Back store', 'ATK-GF-A03']]) {
  const area = await refreshPlace(name)
  if (!area.area_code) await request('/api/save_row', { method: 'POST', body: { table: 'equipment.place', row: { row_id: area.row_id, updated_at: area.updated_at, area_code, area_custodian: staff.row_id } } })
}
const atkSite = await refreshPlace('ATK 1501')
if (!atkSite.site_manager) await request('/api/save_row', { method: 'POST', body: { table: 'equipment.place', row: { row_id: atkSite.row_id, updated_at: atkSite.updated_at, site_manager: 'Administrator' } } })
await withRole('Administrator', 'Assets Accountant')
await withRole(meena.row_id, 'Assets Finance Controller')
for (const [person, finance_role] of [['Administrator', 'Asset accountant'], [meena.row_id, 'Finance controller']]) {
  const named = (await request(`/api/table/equipment.finance_person${query([['person', '=', person], ['finance_role', '=', finance_role]], ['row_id'])}`)).data
  if (!named.length) await request('/api/save_row', { method: 'POST', body: { table: 'equipment.finance_person', row: { person, finance_role } } })
}
const freshCounts = (await request(`/api/table/equipment.count${query([['count_kind', '=', 'Fresh inventory']], ['row_id'])}`)).data
if (!freshCounts.length) {
  const tokens = []
  const tokenFor = async (person) => {
    const access = await request('/api/access_tokens', { method: 'POST', body: { label: 'Assets ATK sample count (removed after seeding)', owner: person, expires_at: new Date(Date.now() + 600_000).toISOString() } })
    tokens.push(access.id)
    return access.token
  }
  const save = (table, row, as) => request('/api/save_row', { method: 'POST', as, body: { table, row } })
  const act = (name, payload, as) => request(`/api/app_actions/equipment/${name}`, { method: 'POST', as, body: { idempotencyKey: crypto.randomUUID(), payload } }).then(r => r.result)
  try {
    const asMeena = await tokenFor(meena.row_id), asSuresh = await tokenFor(staff.row_id)
    await save('equipment.control_setting', { site: places['ATK 1501'], capital_threshold: 5000, recount_threshold: 100000, recount_percent: 10 }, asMeena)
    let count = await save('equipment.count', { count_name: 'ATK 1501 fresh count (pilot D1)', scope_place: places['ATK 1501'], count_kind: 'Fresh inventory', reviewer: 'Administrator',
      starts_on: day(0), ends_on: day(2), freeze_from: day(0), freeze_to: day(2) })
    for (const person of [staff.row_id, ravi.row_id]) await save('equipment.counter', { count: count.row_id, person })
    count = await request(`/api/table/equipment.count/${count.row_id}`)
    await act('start_count', { row_id: count.row_id, updated_at: count.updated_at })
    const line = (area, values) => save('equipment.count_line', { count: count.row_id, place: places[area], tag_status: 'Tagged', condition: 'Working', usage: 'In use',
      ownership: 'Group owned', custodian: staff.row_id, tagged_by: ravi.row_id, ...values }, asSuresh)
    const lines = {}
    lines.chiller1 = await line('ATK Dairy aisle', { tag_no: 'JRA-000301', asset_type: atkTypes['Display chiller'], asset_name: '3-door upright chiller', make: 'Blue Star', model: 'VC350', serial_no: 'SAMPLE-BS23K44871' })
    lines.chiller2 = await line('ATK Dairy aisle', { tag_no: 'JRA-000302', asset_type: atkTypes['Visi cooler'], asset_name: 'Single-door visi cooler', make: 'Western', model: 'SRC 300', serial_no: 'SAMPLE-WS300-1180' })
    await line('ATK Dairy aisle', { tag_status: 'Third-party, not tagged', asset_type: atkTypes['Visi cooler'], asset_name: 'Amul ice cream freezer', make: 'Amul', ownership: 'Vendor or brand supplied', owner_name: 'Amul (Kaira District Co-op)' })
    lines.ac1 = await line('ATK Billing', { tag_no: 'JRA-000401', asset_type: atkTypes['Split AC'], asset_name: 'Split AC 2 ton, billing', make: 'Voltas', model: '243V DZX', serial_no: 'SAMPLE-VT24-118301' })
    lines.ac2 = await line('ATK Billing', { tag_no: 'JRA-000402', asset_type: atkTypes['Split AC'], asset_name: 'Split AC 2 ton, entrance', make: 'Voltas', model: '243V DZX', serial_no: 'SAMPLE-VT24-118302' })
    lines.pos = await line('ATK Billing', { tag_no: 'JRA-000201', asset_type: atkTypes['POS terminal'], asset_name: 'POS terminal, till 1', make: 'HP', model: 'Engage One', serial_no: 'SAMPLE-HPE1-4410' })
    lines.gondola = await line('ATK Back store', { tag_no: 'JRA-000001', asset_type: atkTypes['Gondola run'], asset_name: 'Gondola run, aisle 7', make: 'Kwality Racks' })
    await line('ATK Back store', { tag_status: 'Bulk count, no tag', asset_type: atkTypes['Shopping trolley'], asset_name: 'Shopping trolleys', quantity: 40, condition: 'Working' })
    await save('equipment.tag_event', { tag_no: 'JRA-000002', event_kind: 'Spoiled', reason: 'Torn while peeling', area: places['ATK Back store'], count: count.row_id }, asSuresh)
    // The Administrator signs the dairy aisle for today as site manager: 2 labels for 2 tagged lines.
    await save('equipment.area_close', { count: count.row_id, area: places['ATK Dairy aisle'], labels_used: 2 })

    // The SAP book extract for plant 1501 (SAMPLE numbers) and the asset accountant's matching.
    const book = {}
    for (const [key, sap_asset_no, description, book_value, quantity, extra] of [
      ['chiller', 'SAMPLE-200014', 'Chiller 3-door', 142000, 1, { serial_no: 'SAMPLE-BS23K44871', capitalized_on: '2023-03-12', sap_class_code: '3300' }],
      ['ac', 'SAMPLE-200031', 'AC 2 ton, 6 nos', 288000, 6, { invoice_ref: 'SAMPLE-PO-4410023', capitalized_on: '2022-08-01', sap_class_code: '3200' }],
      ['pos', 'SAMPLE-200052', 'POS terminal HP', 64000, 1, { capitalized_on: '2024-01-15', sap_class_code: '3600' }],
      ['eas', 'SAMPLE-200081', 'EAS gate pair', 96000, 1, { capitalized_on: '2021-11-20', sap_class_code: '3400' }],
      ['dup1', 'SAMPLE-200090', 'Visi cooler single door', 38000, 1, { capitalized_on: '2023-05-02' }],
      ['dup2', 'SAMPLE-200091', 'Visi cooler single door', 38000, 1, { capitalized_on: '2023-05-02' }],
    ]) book[key] = await save('equipment.sap_book', { plant: '1501', sap_company_code: 'SAMPLE-1000', sap_asset_no, sap_asset_sub: '0', description, book_value, quantity, location_text: 'ATK 1501', ...extra })
    await act('match_sap', { sap_book: book.chiller.row_id, lines: [lines.chiller1.row_id], method: 'Serial number' })
    await act('match_sap', { sap_book: book.ac.row_id, lines: [lines.ac1.row_id, lines.ac2.row_id], method: 'Invoice or PO' })
    await act('match_sap', { sap_book: book.dup1.row_id, lines: [lines.chiller2.row_id], method: 'Description, place and date', second_checker: meena.row_id })
    await save('equipment.exception', { outcome: 'In books, not found', sap_asset_no: 'SAMPLE-200081-0', detail: 'EAS gate pair not found in any ATK area', owner: staff.row_id, due_on: day(7) })
    await save('equipment.exception', { outcome: 'Duplicate SAP records', sap_asset_no: 'SAMPLE-200090-0 and SAMPLE-200091-0', detail: 'The same visi cooler is in the book twice', owner: meena.row_id, due_on: day(10) })
    const found = await save('equipment.exception', { outcome: 'Found, not in books', line: lines.gondola.row_id, detail: 'Gondola run in aisle 7 has no SAP record', owner: meena.row_id, due_on: day(10) })
    await save('equipment.exception', { row_id: found.row_id, updated_at: found.updated_at, exception_state: 'Approved', approval_ref: 'SAMPLE-FC/ATK/001' }, asMeena)
  } finally {
    for (const id of tokens) await request(`/api/access_tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}

console.log(`Assets sample data ready at ${origin}/equipment/ (${Object.keys(places).length} places, ${Object.keys(assets).length} assets; SAP numbers are SAMPLE)`)
