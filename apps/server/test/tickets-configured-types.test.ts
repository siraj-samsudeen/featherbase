import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { grantRole, makeTable } from './fixtures'
import { discoverPackages } from '../src/runtime-packages'

// #912 follow-up: ticket types, fields, states and routing are instance
// configuration rows, not app code. The rules are checked on synthetic rows.
const directory = resolve('../..', 'example-apps/tickets')
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': 'tickets@0.2.7' },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
type Ticket = { row_id: string; updated_at: string; ticket_state: string; assigned_to?: string | null; [key: string]: any }
const act = async (client: TestClient, name: string, payload: object) =>
  (await client.post<any>(`/api/app_actions/tickets/${name}`, { idempotencyKey: randomUUID(), payload })).result
const read = async (client: TestClient, name: string, payload: object = {}) =>
  (await client.post<any>(`/api/app_reads/tickets/${name}`, { payload })).result.answer
const revision = (ticket: Ticket) => ({ row_id: ticket.row_id, updated_at: ticket.updated_at })
async function refused(promise: Promise<unknown>, statuses = [403, 409, 417]) {
  let failure: any
  try { await promise } catch (error) { failure = error }
  expect(failure, 'the forbidden write must not succeed').toBeDefined()
  expect(statuses).toContain(failure.status)
  return failure
}
async function setting(admin: TestClient, name: string, value: unknown) {
  const filters = encodeURIComponent(JSON.stringify([['row_id', '=', `tickets.${name}`]]))
  const current = (await admin.get<any>(`/api/table/App%20Setting?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`)).data[0]
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: `tickets.${name}`, updated_at: current?.updated_at, value: JSON.stringify(value) } })
}
const save = (admin: TestClient, table: string, row: object) => admin.post<any>('/api/save_row', { table, row })

async function world(admin: TestClient, createUser: CreateUserFn) {
  await discoverPackages([directory])
  await admin.post('/api/install_app', { name: 'tickets' })
  const owner = await createUser({ email: 'requester@tickets.example.test', fullName: 'Requester' })
  const other = await createUser({ email: 'colleague@tickets.example.test', fullName: 'Colleague' })
  const support = await createUser({ email: 'triager@tickets.example.test', fullName: 'Triager', roles: ['Tickets Support'] })
  const primary = await createUser({ email: 'primary@tickets.example.test', fullName: 'Primary Owner', roles: ['Tickets Support'] })
  // The instance's own Tables, which the app does not own.
  await makeTable(admin, { name: 'Example System', title_column: 'system_name', columns: ['system_name'] })
  await makeTable(admin, { name: 'Example System Owner', columns: [
    { column_name: 'source_system', column_type: 'Reference', reference_table: 'Example System' }, 'person', 'is_primary:Check'] })
  await grantRole(admin, { role: 'All', table: ['Example System', 'Example System Owner'], can_read: true })
  const sap = await save(admin, 'Example System', { system_name: 'SAP' })
  const zakya = await save(admin, 'Example System', { system_name: 'Zakya' })
  await save(admin, 'Example System Owner', { source_system: sap.row_id, person: support.user, is_primary: false })
  await save(admin, 'Example System Owner', { source_system: sap.row_id, person: primary.user, is_primary: true })
  await setting(admin, 'support_users', [support.user, primary.user])
  await setting(admin, 'linked_tables', ['Example System', 'Example System Owner'])
  // Configuration only: a type, its fields, its states and its routing.
  const dq = await save(admin, 'tickets.ticket_type', { type_key: 'data_quality_issue', label: 'Data Quality Issue', enabled: true,
    states: 'Open\nIn progress\nFixed in source\nWon\'t fix\nReopened', done_states: 'Fixed in source\nWon\'t fix', reopen_state: 'Reopened',
    // #918: these checks are about a type whose details are private.
    details_visible_to: 'private',
    routing: JSON.stringify({ field: 'source_system', table: 'Example System Owner', match: 'source_system', person: 'person', primary: 'is_primary' }) })
  const field = (position: number, row: object) => save(admin, 'tickets.type_field', { ticket_type: dq.row_id, field_order: position, ...row })
  await field(1, { field_name: 'source_system', label: 'Source system', field_type: 'link', link_table: 'Example System', link_label: 'system_name', required: true })
  await field(2, { field_name: 'urgency', label: 'Urgency', field_type: 'choice', choices: 'Now\nLater', required: true })
  const removable = await field(3, { field_name: 'field', label: 'Field', field_type: 'text', required: true })
  await field(4, { field_name: 'raised_on', label: 'Raised on', field_type: 'date' })
  await field(5, { field_name: 'raised_for', label: 'Raised for', field_type: 'person' })
  return { owner, other, support, primary, sap: String(sap.row_id), zakya: String(zakya.row_id), removable, dq: String(dq.row_id) }
}
const submit = (client: TestClient, details: object) =>
  act(client, 'create', { title: 'Plant address is wrong', original: 'Two plants carry both door numbers', kind: 'data_quality_issue', details })

describe('Tickets: instance-configured types (#912)', () => {
  test('the form offers the configured type, its fields and the linked rows the caller may read', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const form = await read(w.owner, 'form')
    const type = form.types.find((t: any) => t.key === 'data_quality_issue')
    expect(type).toMatchObject({ label: 'Data Quality Issue', states: ['Open', 'In progress', 'Fixed in source', "Won't fix", 'Reopened'] })
    expect(type.fields.map((f: any) => f.name)).toEqual(['source_system', 'urgency', 'field', 'raised_on', 'raised_for'])
    expect(type.fields[0].options).toEqual(expect.arrayContaining([{ value: w.sap, label: 'SAP' }, { value: w.zakya, label: 'Zakya' }]))
    expect(type.fields[1]).toMatchObject({ type: 'choice', choices: ['Now', 'Later'], required: true })
    // Built-in types stay listed alongside.
    expect(form.types.map((t: any) => t.key)).toContain('access')
  })

  test('a ticket is checked against its type, starts in the first state and routes to the primary owner', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    await refused(submit(w.owner, { source_system: w.sap, field: 'stras' }))
    await refused(submit(w.owner, { source_system: w.sap, field: 'stras', urgency: 'Someday' }))
    await refused(submit(w.owner, { source_system: 'not-a-system', field: 'stras', urgency: 'Now' }))
    await refused(submit(w.owner, { source_system: w.sap, field: 'stras', urgency: 'Now', raised_on: '04-Nov-2026' }))
    const ticket = (await submit(w.owner, { source_system: w.sap, field: 'stras', urgency: 'Now', raised_on: '2026-11-04' })).ticket as Ticket
    expect(ticket).toMatchObject({ kind: 'data_quality_issue', ticket_state: 'Open', assigned_to: w.primary.user })
    // No primary owner recorded for Zakya: unassigned.
    const unrouted = (await submit(w.owner, { source_system: w.zakya, field: 'x', urgency: 'Later' })).ticket as Ticket
    expect(unrouted.assigned_to ?? null).toBeNull()
    const seen = await read(w.support, 'detail', { row_id: ticket.row_id })
    expect(seen.details).toMatchObject({ source_system: w.sap, urgency: 'Now' })
    expect(seen.labels).toMatchObject({ source_system: 'SAP' })
  })

  test('entered values stay private; only support moves a ticket through its states, with history', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    let ticket = (await submit(w.owner, { source_system: w.sap, field: 'stras', urgency: 'Now' })).ticket as Ticket
    const shared = await read(w.other, 'detail', { row_id: ticket.row_id })
    expect(shared.details).toBeUndefined()
    expect(JSON.stringify(shared)).not.toContain('stras')
    await refused(act(w.owner, 'edit', { ...revision(ticket), state: 'Fixed in source' }))
    await refused(act(w.support, 'edit', { ...revision(ticket), state: 'Resolved' }))
    ticket = (await act(w.support, 'edit', { ...revision(ticket), state: 'In progress' })).ticket
    expect(ticket.ticket_state).toBe('In progress')
    ticket = (await act(w.support, 'resolve', { ...revision(ticket), state: 'Fixed in source', reason: 'Corrected in SAP', reference: 'Change note 1' })).ticket
    expect(ticket.ticket_state).toBe('Fixed in source')
    expect((await read(w.support, 'queue', { state: 'open' })).tickets.map((t: Ticket) => t.row_id)).not.toContain(ticket.row_id)
    ticket = (await act(w.support, 'reopen', { ...revision(ticket), reason: 'Came back' })).ticket
    expect(ticket.ticket_state).toBe('Reopened')
    const operations = (await read(w.support, 'detail', { row_id: ticket.row_id })).privateEvents.map((e: any) => e.operation)
    expect(operations).toEqual(expect.arrayContaining(['edit', 'resolve', 'reopen']))
  })

  test('removing a field or a linked Table is configuration, not a release', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    await refused(submit(w.owner, { source_system: w.sap, urgency: 'Now' }))
    await admin.fetch(`/api/table/tickets.type_field/${w.removable.row_id}?updated_at=${encodeURIComponent(w.removable.updated_at)}`, { method: 'DELETE' })
    expect((await submit(w.owner, { source_system: w.sap, urgency: 'Now' })).ticket.ticket_state).toBe('Open')
    // A Table no longer listed in linked_tables is not read: its link offers nothing and is refused.
    await setting(admin, 'linked_tables', [])
    const type = (await read(w.owner, 'form')).types.find((t: any) => t.key === 'data_quality_issue')
    expect(type.fields[0].options).toEqual([])
    await refused(submit(w.owner, { source_system: w.sap, urgency: 'Now' }))
  })

  test('a person field takes any Person the requester may see, and only those, shown by name', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    // Someone who has never used Tickets.
    const outsider = await createUser({ email: 'outsider@tickets.example.test', fullName: 'Outside Owner' })
    await grantRole(admin, { role: 'Person Reader', table: 'Person', can_read: true })
    const reader = await createUser({ email: 'reader@tickets.example.test', fullName: 'Reader', roles: ['Person Reader'] })
    const base = { source_system: w.sap, field: 'stras', urgency: 'Now', raised_for: outsider.user }
    await refused(submit(w.owner, base))
    const ticket = (await submit(reader, base)).ticket as Ticket
    const seen = await read(w.support, 'detail', { row_id: ticket.row_id })
    expect(seen.details.raised_for).toBe(outsider.user)
    expect((await read(reader, 'detail', { row_id: ticket.row_id })).names[outsider.user!]).toBe('Outside Owner')
  })

  test('configuration cannot shadow the access type or name protected keys, and only a System Manager configures', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    await refused(save(admin, 'tickets.ticket_type', { type_key: 'access', label: 'Access', states: 'Open', enabled: true }))
    await refused(save(admin, 'tickets.type_field', { ticket_type: w.dq, field_name: 'original', label: 'x', field_type: 'text' }))
    await refused(save(admin, 'tickets.type_field', { ticket_type: w.dq, field_name: 'kind_two', label: 'x', field_type: 'choice' }))
    await refused(save(w.support, 'tickets.ticket_type', { type_key: 'sneaky', label: 'Sneaky', states: 'Open', enabled: true }))
  })
})
