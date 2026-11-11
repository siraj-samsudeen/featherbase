import { resolve } from 'node:path'
import { expect } from 'vitest'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { installApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { version } from '../../../client-apps/jeyarama/equipment/package.json'

type Row = { row_id: string; updated_at: string; [field: string]: unknown }

function assetsClient(client: TestClient): TestClient {
  return makeClient({ request: (path, init) => client.fetch(String(path), {
    ...init,
    headers: { 'X-Featherbase-App-Version': `equipment@${version}`, ...init?.headers },
  }) }, client.token, client.user)
}

const istDay = (offset = 0) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10)

async function pilot(createUser: (options: { roles: string[]; fullName?: string }) => Promise<TestClient>) {
  expect(await discoverPackages([resolve('../..', 'client-apps/jeyarama/equipment')])).toEqual([])
  await installApp('equipment')
  const person = async (fullName: string, ...roles: string[]) => assetsClient(await createUser({ roles: ['Assets Member', ...roles], fullName }))
  const manager = assetsClient(await createUser({ roles: ['Assets Manager'], fullName: 'Pilot lead' }))
  const ravi = await person('Ravi'), meena = await person('Meena'), senthil = await person('Senthil')
  const accountant = await person('Anand', 'Assets Accountant'), checker = await person('Divya', 'Assets Accountant')
  const controller = await person('Lakshmi', 'Assets Finance Controller')
  const save = (table: string, row: Record<string, unknown>, as: TestClient = manager) => as.post<Row>('/api/save_row', { table, row })
  const change = (table: string, row: Row, values: Record<string, unknown>, as: TestClient = manager) => save(table, { row_id: row.row_id, updated_at: row.updated_at, ...values }, as)
  const get = (table: string, id: string, as: TestClient = manager) => as.get<Row>(`/api/table/${table}/${id}`)
  const act = <T = Row>(as: TestClient, name: string, payload: Record<string, unknown>) =>
    as.post<{ result: T }>(`/api/app_actions/equipment/${name}`, { idempotencyKey: crypto.randomUUID(), payload }).then(r => r.result)
  // The pilot names its Finance people, as in the plan's team list.
  for (const [who, finance_role] of [[accountant, 'Asset accountant'], [checker, 'Asset accountant'], [controller, 'Finance controller']] as const)
    await save('equipment.finance_person', { person: who.user, finance_role })
  const atk = await save('equipment.place', { place_name: 'ATK 1501', place_level: 'Site', sap_plant: '1501', site_manager: senthil.user })
  const dairy = await save('equipment.place', { place_name: 'Dairy', place_level: 'Area', parent_place: atk.row_id, area_code: 'ATK-GF-A03', area_custodian: meena.user })
  const cold = await save('equipment.asset_class', { class_name: 'Refrigeration and cold chain', sap_class_code: '3300' })
  const chiller = await save('equipment.asset_type', { type_name: 'Display chiller', asset_class: cold.row_id, sticker: 'Freezer-grade', counting_note: 'Outside the door' })
  const retail = await save('equipment.asset_class', { class_name: 'Retail store equipment' })
  const trolley = await save('equipment.asset_type', { type_name: 'Shopping trolley', asset_class: retail.row_id, sticker: 'No sticker' })
  await save('equipment.tag_roll', { roll_name: 'Freezer-grade roll 1', sticker: 'Freezer-grade', first_no: 1, last_no: 200, team: 'Team A' })
  const count = await save('equipment.count', { count_name: 'ATK 1501 fresh count', scope_place: atk.row_id, count_kind: 'Fresh inventory', reviewer: manager.user,
    freeze_from: istDay(-1), freeze_to: istDay(1) })
  for (const counter of [ravi, meena]) await save('equipment.counter', { count: count.row_id, person: counter.user })
  await act(manager, 'start_count', { row_id: count.row_id, updated_at: (await get('equipment.count', count.row_id)).updated_at })
  const line = (as: TestClient, values: Record<string, unknown>) => save('equipment.count_line', {
    asset_name: '3-door upright chiller', asset_type: chiller.row_id, place: dairy.row_id, count: count.row_id, tag_status: 'Tagged',
    make: 'Blue Star', model: 'VC350', condition: 'Working', usage: 'In use', ownership: 'Group owned', tagged_by: ravi.user, ...values }, as)
  return { manager, ravi, meena, senthil, accountant, checker, controller, save, change, get, act, atk, dairy, cold, chiller, trolley, count, line }
}

test('a count line takes a JRA tag from an issued roll, its class from its type, and both initials', async ({ createUser }) => {
  const p = await pilot(createUser)
  const asset = await p.line(p.meena, { tag_no: 'JRA-000123', serial_no: 'BS23K44871' })
  expect(asset).toMatchObject({ tag_no: 'JRA-000123', asset_class: p.cold.row_id, tagged_by: p.ravi.user, recorded_by: p.meena.user, count: p.count.row_id })
  await expect(p.line(p.meena, { tag_no: 'JRA-000123' })).rejects.toThrow('JRA-000123 is already on another asset; tag numbers are never reused')
  await expect(p.line(p.meena, { tag_no: 'AST-0001' })).rejects.toThrow('A tag is JRA- and six digits')
  await expect(p.line(p.meena, { tag_no: 'JRA-000500' })).rejects.toThrow('JRA-000500 is not on an issued tag roll')
  await p.save('equipment.tag_event', { tag_no: 'JRA-000124', event_kind: 'Spoiled', reason: 'Torn while peeling' }, p.ravi)
  await expect(p.line(p.meena, { tag_no: 'JRA-000124' })).rejects.toThrow('JRA-000124 was spoiled; tag numbers are never reused')
  await expect(p.line(p.meena, { tag_no: 'JRA-000125', tagged_by: p.meena.user })).rejects.toThrow('Both team members initial')
  await expect(p.line(p.senthil, { tag_no: 'JRA-000125' })).rejects.toThrow('Only this count’s team records lines')
  await expect(p.change('equipment.count_line', asset, { tag_no: 'JRA-000126' }, p.meena)).rejects.toThrow('A tag number never changes')
})

test('bulk items take one line with a quantity, and third-party items name their owner without a group tag', async ({ createUser }) => {
  const p = await pilot(createUser)
  await expect(p.line(p.meena, { asset_type: p.trolley.row_id, asset_name: 'Shopping trolleys', tag_status: 'Bulk count, no tag', tag_no: 'JRA-000130', quantity: 40 }))
    .rejects.toThrow('Only a tagged line carries a tag')
  expect(await p.line(p.meena, { asset_type: p.trolley.row_id, asset_name: 'Shopping trolleys', tag_status: 'Bulk count, no tag', quantity: 40 })).toMatchObject({ quantity: 40, tag_no: null })
  await expect(p.line(p.meena, { tag_no: 'JRA-000131', ownership: 'Vendor or brand supplied' })).rejects.toThrow('Name the owner of a third-party item')
  await expect(p.line(p.meena, { tag_no: 'JRA-000131', ownership: 'Vendor or brand supplied', owner_name: 'Amul' }))
    .rejects.toThrow('A third-party item carries no group tag unless Finance approves')
  expect(await p.line(p.meena, { tag_status: 'Third-party, not tagged', ownership: 'Vendor or brand supplied', owner_name: 'Amul', asset_name: 'Amul ice cream freezer' }))
    .toMatchObject({ ownership: 'Vendor or brand supplied', owner_name: 'Amul', tag_no: null })
})

test('only the site manager closes an area, and only when the labels used add up; then the area is shut for the day', async ({ createUser }) => {
  const p = await pilot(createUser)
  for (const tag of ['JRA-000001', 'JRA-000002', 'JRA-000003']) await p.line(p.meena, { tag_no: tag })
  await p.line(p.meena, { asset_type: p.trolley.row_id, asset_name: 'Trolleys', tag_status: 'Bulk count, no tag', quantity: 12 })
  await p.save('equipment.tag_event', { tag_no: 'JRA-000004', event_kind: 'Spoiled', reason: 'Printed crooked', area: p.dairy.row_id, count: p.count.row_id }, p.ravi)
  const close = (labels_used: number, as: TestClient) => p.save('equipment.area_close', { count: p.count.row_id, area: p.dairy.row_id, labels_used }, as)
  await expect(close(4, p.meena)).rejects.toThrow('Only the site manager signs an area')
  await expect(close(5, p.senthil)).rejects.toThrow('5 labels used, but 3 tagged lines and 1 spoiled label: find the difference before signing')
  expect(await close(4, p.senthil)).toMatchObject({ tagged_lines: 3, other_lines: 1, spoiled: 1, signed_by: p.senthil.user, close_day: expect.anything() })
  await expect(p.line(p.meena, { tag_no: 'JRA-000005' })).rejects.toThrow('Dairy is closed for today')
})

test('during the count dates a transfer into or out of the site needs the site manager’s note', async ({ createUser }) => {
  const p = await pilot(createUser)
  const store = await p.save('equipment.place', { place_name: 'Enchakkal WH 9151', place_level: 'Site' })
  const request = { transfer_kind: 'Between sites', from_place: p.atk.row_id, to_place: store.row_id, reason: 'Send spare scale' }
  await expect(p.save('equipment.transfer', request)).rejects.toThrow('ATK 1501 is in its count freeze; the site manager’s written note is needed')
  await expect(p.save('equipment.transfer', { ...request, freeze_note: 'OK to move' })).rejects.toThrow('Only the site manager writes the freeze note')
  // The site manager raises it with their note; the note is kept with their name.
  await p.save('equipment.place', { row_id: p.atk.row_id, updated_at: (await p.get('equipment.place', p.atk.row_id)).updated_at, site_manager: p.manager.user })
  expect(await p.save('equipment.transfer', { ...request, freeze_note: 'Scale needed at Enchakkal for Diwali; counted already' }))
    .toMatchObject({ freeze_note_by: p.manager.user, transfer_state: 'Requested' })
})

test('only Finance sets the control category and book value', async ({ createUser }) => {
  const p = await pilot(createUser)
  const asset = await p.line(p.meena, { tag_no: 'JRA-000010' })
  await expect(p.change('equipment.count_line', asset, { control_category: 'Capital asset in SAP' })).rejects.toThrow('Only Finance sets the control category and book value')
  expect(await p.change('equipment.count_line', asset, { control_category: 'Controlled item' }, p.accountant)).toMatchObject({ control_category: 'Controlled item' })
})

test('the asset accountant matches SAP records to tags; the count team never matches', async ({ createUser }) => {
  const p = await pilot(createUser)
  const tags = []
  for (const tag of ['JRA-000021', 'JRA-000022', 'JRA-000023']) tags.push(await p.line(p.meena, { tag_no: tag, asset_name: 'Split AC 2 ton' }))
  const record = await p.save('equipment.sap_book', { plant: '1501', sap_asset_no: '200031', sap_asset_sub: '0', description: 'AC 2 ton, 6 nos', book_value: 288000, quantity: 6 }, p.accountant)
  // An accountant put on the count team can't then match that count's items.
  await p.save('equipment.counter', { count: p.count.row_id, person: p.checker.user })
  await expect(p.act(p.checker, 'match_sap', { sap_book: record.row_id, lines: [tags[0].row_id], method: 'Serial number' }))
    .rejects.toThrow('The count team never matches: you are on the team that counted JRA-000021')
  await expect(p.act(p.accountant, 'match_sap', { sap_book: record.row_id, lines: [tags[0].row_id], method: 'Description, place and date' }))
    .rejects.toThrow('A match by description, place and date needs a second person to check it')
  await expect(p.act(p.accountant, 'match_sap', { sap_book: record.row_id, lines: [tags[0].row_id], method: 'Description, place and date', second_checker: p.accountant.user }))
    .rejects.toThrow('Someone other than the matcher checks it')
  const result = await p.act<{ matched: number }>(p.accountant, 'match_sap', { sap_book: record.row_id, lines: tags.map(tag => tag.row_id), method: 'Invoice or PO' })
  expect(result.matched).toBe(3)
  // One record of six links to three tags; each carries its share of the book value.
  const first = await p.get('equipment.count_line', tags[0].row_id)
  expect(first).toMatchObject({ sap_asset_no: '200031', sap_asset_sub: '0', control_category: 'Capital asset in SAP' })
  expect(Number(first.book_value)).toBe(48000)
  await expect(p.act(p.accountant, 'match_sap', { sap_book: record.row_id, lines: [tags[0].row_id], method: 'Serial number' }))
    .rejects.toThrow('JRA-000021 is already matched to 200031-0')
  await expect(p.meena.get('/api/table/equipment.sap_book')).rejects.toThrow()
})

test('an exception is approved only by a Finance Controller who did not raise it and is not an asset accountant', async ({ createUser }) => {
  const p = await pilot(createUser)
  const exception = await p.save('equipment.exception', { outcome: 'In books, not found', sap_asset_no: '200081-0', detail: 'EAS gate pair not found in any area', owner: p.senthil.user, due_on: istDay(5) }, p.accountant)
  expect(exception).toMatchObject({ raised_by: p.accountant.user, exception_state: 'Open' })
  await expect(p.change('equipment.exception', exception, { exception_state: 'Approved', approval_ref: 'FC/ATK/001' }, p.accountant))
    .rejects.toThrow('Only a Finance Controller approves')
  await expect(p.change('equipment.exception', exception, { exception_state: 'Approved' }, p.controller)).rejects.toThrow('Give the approval reference')
  expect(await p.change('equipment.exception', exception, { exception_state: 'Approved', approval_ref: 'FC/ATK/001' }, p.controller))
    .toMatchObject({ exception_state: 'Approved', approved_by: p.controller.user })
  const own = await p.save('equipment.exception', { outcome: 'Duplicate SAP records', sap_asset_no: '200090-0', detail: 'Same chiller twice' }, p.controller)
  await expect(p.change('equipment.exception', own, { exception_state: 'Approved', approval_ref: 'FC/ATK/002' }, p.controller)).rejects.toThrow('Nobody approves an exception they raised')
})

test('the independent recount flags every line over Finance’s threshold plus a 10% sample, and someone outside the team records it', async ({ createUser }) => {
  const p = await pilot(createUser)
  const lines = []
  for (let n = 31; n <= 50; n++) lines.push(await p.line(p.meena, { tag_no: `JRA-0000${n}` }))
  for (const line of lines.slice(0, 2)) await p.change('equipment.count_line', await p.get('equipment.count_line', line.row_id), { book_value: 250000 }, p.accountant)
  await expect(p.act(p.meena, 'start_recount', { count: p.count.row_id })).rejects.toThrow('Only an Assets Manager starts the independent recount')
  await expect(p.act(p.manager, 'start_recount', { count: p.count.row_id })).rejects.toThrow('Set the recount threshold for ATK 1501 first')
  await expect(p.save('equipment.control_setting', { site: p.atk.row_id, recount_threshold: 200000 })).rejects.toThrow()
  await p.save('equipment.control_setting', { site: p.atk.row_id, recount_threshold: 200000, recount_percent: 10 }, p.controller)
  // 2 over the threshold, and 10% of the other 18, rounded up to 2.
  expect(await p.act<{ sampled: number }>(p.manager, 'start_recount', { count: p.count.row_id })).toEqual({ sampled: 4 })
  await expect(p.act(p.manager, 'start_recount', { count: p.count.row_id })).rejects.toThrow('This count’s recount has already started')
  const flagged = await p.manager.get<{ data: Row[] }>(`/api/table/equipment.count_line?fields=["row_id","updated_at"]&filters=${encodeURIComponent(JSON.stringify([['for_recount', '=', true]]))}`)
  expect(flagged.data.map(row => row.row_id)).toEqual(expect.arrayContaining([lines[0].row_id, lines[1].row_id]))
  const sampled = flagged.data[0]
  await expect(p.change('equipment.count_line', sampled, { recount_result: 'Found as counted' }, p.meena)).rejects.toThrow('Someone outside the count team recounts')
  expect(await p.change('equipment.count_line', sampled, { recount_result: 'Found, details differ' }, p.senthil)).toMatchObject({ recounted_by: p.senthil.user })
  const notSampled = lines.find(line => !flagged.data.some(row => row.row_id === line.row_id))!
  await expect(p.change('equipment.count_line', await p.get('equipment.count_line', notSampled.row_id), { recount_result: 'Found as counted' }, p.senthil))
    .rejects.toThrow('This line is not in the recount')
})

test('the pilot lead loads the group’s counted lines into the register with their tags and SAP numbers', async ({ createUser }) => {
  const p = await pilot(createUser)
  const tagged = await p.line(p.meena, { tag_no: 'JRA-000061', serial_no: 'BS-61' })
  await p.line(p.meena, { tag_status: 'Third-party, not tagged', ownership: 'Vendor or brand supplied', owner_name: 'Amul', asset_name: 'Amul freezer' })
  const record = await p.save('equipment.sap_book', { plant: '1501', sap_asset_no: '200014', description: 'Chiller 3-door', book_value: 142000, quantity: 1 }, p.accountant)
  await p.act(p.accountant, 'match_sap', { sap_book: record.row_id, lines: [tagged.row_id], method: 'Serial number' })
  await expect(p.act(p.meena, 'load_register', { count: p.count.row_id })).rejects.toThrow('Only an Assets Manager loads the register')
  expect(await p.act(p.manager, 'load_register', { count: p.count.row_id })).toEqual({ loaded: 1 })
  const line = await p.get('equipment.count_line', tagged.row_id)
  expect(await p.get('equipment.asset', String(line.asset))).toMatchObject({ tag_no: 'JRA-000061', sap_asset_no: '200014', asset_class: p.cold.row_id,
    control_category: 'Capital asset in SAP', book_status: 'Capitalized', place: p.dairy.row_id, serial_no: 'BS-61' })
  expect(await p.act(p.manager, 'load_register', { count: p.count.row_id })).toEqual({ loaded: 0 })
})
