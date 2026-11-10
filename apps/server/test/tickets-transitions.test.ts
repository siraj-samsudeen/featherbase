import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { grantRole, makeTable } from './fixtures'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'

// #918: a ticket type's own transitions — who may take which action from
// which state, and what they must record. The rules run on synthetic rows.
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
async function refused(promise: Promise<unknown>, message?: RegExp, statuses = [403, 409, 417]) {
  let failure: any
  try { await promise } catch (error) { failure = error }
  expect(failure, 'the forbidden write must not succeed').toBeDefined()
  expect(statuses).toContain(failure.status)
  if (message) expect(JSON.stringify(failure.body ?? failure.message)).toMatch(message)
  return failure
}
async function setting(admin: TestClient, name: string, value: unknown) {
  const filters = encodeURIComponent(JSON.stringify([['row_id', '=', `tickets.${name}`]]))
  const current = (await admin.get<any>(`/api/table/App%20Setting?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`)).data[0]
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: `tickets.${name}`, updated_at: current?.updated_at, value: JSON.stringify(value) } })
}
const save = (admin: TestClient, table: string, row: object) => admin.post<any>('/api/save_row', { table, row })

// The Data Quality Issue cycle approved on 04-Nov-2026, as configuration.
export const dataQualityTransitions = [
  { state: 'Raised', action: 'Confirm', next_state: 'Fix planned', allowed: 'assignee', fields: ['fix_what', 'fix_where', 'target_date'] },
  { state: 'Raised', action: 'Ask a question', next_state: 'Waiting for raiser', allowed: 'assignee', fields: ['question'] },
  { state: 'Waiting for raiser', action: 'Answer', next_state: 'Raised', allowed: 'requester', fields: ['answer'] },
  { state: 'Raised', action: 'Reject', next_state: 'Rejected', allowed: 'assignee', fields: ['rejection_reason'] },
  { state: 'Rejected', action: 'Reopen', next_state: 'Raised', allowed: 'requester' },
  { state: 'Fix planned', action: 'Mark fixed', next_state: 'Fixed: to verify', allowed: 'assignee', fields: ['what_changed'] },
  { state: 'Fixed: to verify', action: 'Verify', next_state: 'Closed', allowed: 'requester' },
  { state: 'Fixed: to verify', action: 'Verify', next_state: 'Closed', allowed: 'Data Quality Verifier' },
  { state: 'Fixed: to verify', action: 'Not fixed', next_state: 'Fix planned', allowed: 'requester', fields: ['still_wrong'] },
]
const states = ['Raised', 'Waiting for raiser', 'Fix planned', 'Fixed: to verify', 'Closed', 'Rejected']

async function world(admin: TestClient, createUser: CreateUserFn, visibility?: 'everyone' | 'private') {
  await discoverPackages([directory])
  await admin.post('/api/install_app', { name: 'tickets' })
  await grantRole(admin, { role: 'Data Quality Verifier', table: 'tickets.ticket', can_read: true })
  const raiser = await createUser({ email: 'raiser@tickets.example.test', fullName: 'Raiser' })
  const colleague = await createUser({ email: 'colleague@tickets.example.test', fullName: 'Colleague' })
  const support = await createUser({ email: 'triager@tickets.example.test', fullName: 'Triager', roles: ['Tickets Support'] })
  const contact = await createUser({ email: 'contact@tickets.example.test', fullName: 'Primary Contact', roles: ['Tickets Support'] })
  const verifier = await createUser({ email: 'verifier@tickets.example.test', fullName: 'Verifier', roles: ['Data Quality Verifier'] })
  await makeTable(admin, { name: 'Example System', title_column: 'system_name', columns: ['system_name'] })
  await makeTable(admin, { name: 'Example Support Contact', columns: [
    { column_name: 'source_system', column_type: 'Reference', reference_table: 'Example System' }, 'person', 'is_primary:Check'] })
  await grantRole(admin, { role: 'All', table: ['Example System', 'Example Support Contact'], can_read: true })
  const sap = await save(admin, 'Example System', { system_name: 'SAP' })
  await save(admin, 'Example Support Contact', { source_system: sap.row_id, person: contact.user, is_primary: true })
  await setting(admin, 'support_users', [support.user, contact.user])
  await setting(admin, 'linked_tables', ['Example System', 'Example Support Contact'])
  const dq = await save(admin, 'tickets.ticket_type', { type_key: 'data_quality_issue', label: 'Data Quality Issue', enabled: true,
    states: states.join('\n'), done_states: 'Closed\nRejected',
    routing: JSON.stringify({ field: 'source_system', table: 'Example Support Contact', match: 'source_system', person: 'person', primary: 'is_primary' }),
    transitions: JSON.stringify(dataQualityTransitions), ...(visibility ? { details_visible_to: visibility } : {}) })
  let order = 0
  const field = (row: object) => save(admin, 'tickets.type_field', { ticket_type: dq.row_id, field_order: ++order, ...row })
  await field({ field_name: 'source_system', label: 'Source system', field_type: 'link', link_table: 'Example System', link_label: 'system_name', required: true })
  await field({ field_name: 'current_value', label: 'Current value', field_type: 'text' })
  await field({ field_name: 'fix_what', label: 'What will be fixed', field_type: 'long text' })
  await field({ field_name: 'fix_where', label: 'Where it will be fixed', field_type: 'text' })
  await field({ field_name: 'target_date', label: 'Target date', field_type: 'date' })
  await field({ field_name: 'question', label: 'Question', field_type: 'long text' })
  await field({ field_name: 'answer', label: 'Answer', field_type: 'long text' })
  await field({ field_name: 'rejection_reason', label: 'Why it is rejected', field_type: 'long text' })
  await field({ field_name: 'what_changed', label: 'What was changed', field_type: 'long text' })
  await field({ field_name: 'still_wrong', label: 'What is still wrong', field_type: 'long text' })
  return { raiser, colleague, support, contact, verifier, sap: String(sap.row_id), dq }
}
type World = Awaited<ReturnType<typeof world>>
const raise = async (w: World) => (await act(w.raiser, 'create', { title: 'Plant address is wrong', original: 'Two plants carry both door numbers',
  kind: 'data_quality_issue', details: { source_system: w.sap, current_value: '78/499/1' } })).ticket as Ticket
const take = async (client: TestClient, ticket: Ticket, action: string, values?: object) =>
  (await act(client, 'transition', { ...revision(ticket), action, ...(values ? { values } : {}) })).ticket as Ticket
const offered = async (client: TestClient, ticket: Ticket) =>
  ((await read(client, 'detail', { row_id: ticket.row_id })).actions ?? []).map((a: any) => a.action)
const plan = { fix_what: 'Door number', fix_where: 'SAP plant master', target_date: '2026-11-10' }

describe('Tickets: transitions per ticket type (#918)', () => {
  test('details visible to everyone: anyone who sees the ticket reads its details and history; a non-support assignee works it', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    // The routed contact is not a Tickets support user (Vivek on staging, 04-Nov-2026).
    const vivek = await createUser({ email: 'vivek@tickets.example.test', fullName: 'Vivek' })
    const contacts = await admin.get<any>(`/api/table/Example%20Support%20Contact?fields=${encodeURIComponent('["row_id","updated_at"]')}`)
    await save(admin, 'Example Support Contact', { ...contacts.data[0], person: vivek.user })
    let ticket = await raise(w)
    expect(ticket.assigned_to).toBe(vivek.user)
    for (const reader of [vivek, w.colleague]) {
      const seen = await read(reader, 'detail', { row_id: ticket.row_id })
      expect(seen.details).toMatchObject({ current_value: '78/499/1', original: 'Two plants carry both door numbers' })
    }
    expect(await offered(vivek, ticket)).toEqual(['Confirm', 'Ask a question', 'Reject'])
    ticket = await take(vivek, ticket, 'Confirm', plan)
    const seen = await read(w.colleague, 'detail', { row_id: ticket.row_id })
    expect(seen.details).toMatchObject(plan)
    expect(seen.privateEvents.map((e: any) => [e.operation, e.by])).toEqual([['transition', vivek.user]])
    // Reassigning moves the assignee's actions to the new assignee.
    ticket = (await act(w.support, 'edit', { ...revision(ticket), assigned_to: w.contact.user })).ticket
    await refused(take(vivek, ticket, 'Mark fixed', { what_changed: 'x' }), /not allowed/i)
    expect((await take(w.contact, ticket, 'Mark fixed', { what_changed: 'Door number corrected' })).ticket_state).toBe('Fixed: to verify')
  })

  test('the requester and support correct the wording; the earlier wording is kept; anyone else is refused', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    let ticket = await raise(w)
    await refused(act(w.colleague, 'edit', { ...revision(ticket), original: 'Hijacked' }), /authorized/i)
    await refused(act(w.raiser, 'edit', { ...revision(ticket), original: '  ' }), /Original request is required/)
    ticket = (await act(w.raiser, 'edit', { ...revision(ticket), original: 'Attakulangara carries both door numbers' })).ticket
    ticket = (await act(w.support, 'edit', { ...revision(ticket), original: 'Attakulangara (ATK) carries both door numbers' })).ticket
    // The open copy is what everyone reads, and it carries the history.
    const seen = await read(w.colleague, 'detail', { row_id: ticket.row_id })
    expect(seen.details.original).toBe('Attakulangara (ATK) carries both door numbers')
    expect(seen.originalHistory.map((h: any) => [h.text, h.replaced_by])).toEqual([
      ['Two plants carry both door numbers', w.raiser.user], ['Attakulangara carries both door numbers', w.support.user]])
    expect(seen.originalHistory[0].replaced_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(seen.privateEvents.filter((e: any) => JSON.parse(e.text).original_before).map((e: any) => [e.by, JSON.parse(e.text).original])).toEqual([
      [w.raiser.user, 'Attakulangara carries both door numbers'], [w.support.user, 'Attakulangara (ATK) carries both door numbers']])
    // Never through a generic write.
    const [open] = (await admin.get<any>(`/api/table/tickets.open_request?filters=${encodeURIComponent(JSON.stringify([['row_id', '=', ticket.row_id]]))}&fields=${encodeURIComponent('["row_id","updated_at","original"]')}`)).data
    await refused(save(w.raiser, 'tickets.open_request', { ...open, original: 'Generic write' }))
  })

  test("a private ticket's wording is corrected in its private request, opened copy included", async ({ admin, createUser }) => {
    const w = await world(admin, createUser, 'private')
    let ticket = await raise(w)
    ticket = (await act(w.raiser, 'edit', { ...revision(ticket), original: 'Attakulangara carries both door numbers' })).ticket
    const own = await read(w.raiser, 'detail', { row_id: ticket.row_id })
    expect(own.details.original).toBe('Attakulangara carries both door numbers')
    expect(own.originalHistory.map((h: any) => h.text)).toEqual(['Two plants carry both door numbers'])
    expect(JSON.stringify(await read(w.colleague, 'detail', { row_id: ticket.row_id }))).not.toContain('Attakulangara')
    // Opened later, then corrected again: both copies stay in step.
    const row = (await admin.get<any>(`/api/table/tickets.ticket_type/${w.dq.row_id}`))
    await save(admin, 'tickets.ticket_type', { ...row, details_visible_to: 'everyone' })
    await act(w.support, 'open_details', { row_id: ticket.row_id })
    ticket = (await act(w.support, 'edit', { ...revision(ticket), original: 'ATK carries both door numbers' })).ticket
    expect((await read(w.colleague, 'detail', { row_id: ticket.row_id })).originalHistory.map((h: any) => h.text))
      .toEqual(['Two plants carry both door numbers', 'Attakulangara carries both door numbers'])
    const [kept] = await sql`select original from tickets.request where row_id = ${ticket.row_id}`
    expect(kept.original).toBe('ATK carries both door numbers')
  })

  test('a ticket raised while its type was private is opened by support, with its history, when the type opens', async ({ admin, createUser }) => {
    const w = await world(admin, createUser, 'private')
    let ticket = await raise(w)
    ticket = await take(w.contact, ticket, 'Ask a question', { question: 'Which plant?' })
    expect((await read(w.colleague, 'detail', { row_id: ticket.row_id })).details).toBeUndefined()
    const row = (await admin.get<any>(`/api/table/tickets.ticket_type/${w.dq.row_id}`))
    await save(admin, 'tickets.ticket_type', { ...row, details_visible_to: 'everyone' })
    await refused(act(w.raiser, 'open_details', { row_id: ticket.row_id }), /support/)
    expect(await act(w.support, 'open_details', { row_id: ticket.row_id })).toMatchObject({ opened: true, events: 1 })
    expect(await act(w.support, 'open_details', { row_id: ticket.row_id })).toMatchObject({ opened: false })
    const seen = await read(w.colleague, 'detail', { row_id: ticket.row_id })
    expect(seen.details).toMatchObject({ current_value: '78/499/1', question: 'Which plant?' })
    expect(seen.privateEvents.map((e: any) => [e.operation, e.by])).toEqual([['transition', w.contact.user]])
    // It carries on in the open Tables.
    ticket = await take(w.raiser, ticket, 'Answer', { answer: 'Plant 1100' })
    expect((await read(w.colleague, 'detail', { row_id: ticket.row_id })).details.answer).toBe('Plant 1100')
  })

  test('private details: only the requester and support read them, through the app and the generic API', async ({ admin, createUser }) => {
    const w = await world(admin, createUser, 'private')
    let ticket = await raise(w)
    ticket = await take(w.contact, ticket, 'Confirm', plan)
    const shared = await read(w.colleague, 'detail', { row_id: ticket.row_id })
    expect(shared.details).toBeUndefined()
    expect(shared.privateEvents).toBeUndefined()
    expect(JSON.stringify(shared)).not.toContain('78/499/1')
    expect((await read(w.raiser, 'detail', { row_id: ticket.row_id })).details).toMatchObject(plan)
    for (const table of ['tickets.request', 'tickets.event', 'tickets.open_request', 'tickets.open_event']) {
      const listed = await w.colleague.fetch(`/api/table/${table}?limit_page_length=500`)
      expect(JSON.stringify(await listed.json())).not.toMatch(/78\/499\/1|SAP plant master/)
    }
    // Changing a ticket between an open and a private type is refused: details never move.
    await save(admin, 'tickets.ticket_type', { type_key: 'open_issue', label: 'Open issue', enabled: true, states: 'Open' })
    await save(admin, 'tickets.ticket_type', { type_key: 'private_issue', label: 'Private issue', enabled: true, states: 'Open', details_visible_to: 'private' })
    const plain = (await act(w.raiser, 'create', { title: 'p', original: 'o', kind: 'private_issue', details: {} })).ticket as Ticket
    await refused(act(w.support, 'edit', { ...revision(plain), kind: 'open_issue' }), /private/)
    await refused(save(admin, 'tickets.ticket_type', { type_key: 'odd_visibility', label: 'Odd', states: 'Open', details_visible_to: 'some' }))
  })

  test('the form leaves action fields to their action; a ticket starts in the first state, routed to the contact', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const type = (await read(w.raiser, 'form')).types.find((t: any) => t.key === 'data_quality_issue')
    expect(type.transitions).toBe(true)
    expect(type.fields.filter((f: any) => !f.asked_by_action).map((f: any) => f.name)).toEqual(['source_system', 'current_value'])
    expect(type.fields.find((f: any) => f.name === 'target_date')).toMatchObject({ asked_by_action: true })
    await refused(act(w.raiser, 'create', { title: 't', original: 'o', kind: 'data_quality_issue', details: { source_system: w.sap, fix_what: 'sneaky' } }), /recorded by an action/)
    const ticket = await raise(w)
    expect(ticket).toMatchObject({ ticket_state: 'Raised', assigned_to: w.contact.user })
  })

  test('only the listed moves are offered and accepted, to the people they name, with their fields', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    let ticket = await raise(w)
    expect(await offered(w.contact, ticket)).toEqual(['Confirm', 'Ask a question', 'Reject'])
    expect(await offered(w.raiser, ticket)).toEqual([])
    expect(await offered(w.colleague, ticket)).toEqual([])
    const confirm = (await read(w.contact, 'detail', { row_id: ticket.row_id })).actions[0]
    expect(confirm).toMatchObject({ action: 'Confirm', next_state: 'Fix planned' })
    expect(confirm.fields.map((f: any) => [f.name, f.label, f.type])).toEqual([
      ['fix_what', 'What will be fixed', 'long text'], ['fix_where', 'Where it will be fixed', 'text'], ['target_date', 'Target date', 'date']])
    // Not the assignee; a missing, malformed or unknown field; an action from another state.
    await refused(take(w.raiser, ticket, 'Confirm', plan), /not allowed/i)
    await refused(take(w.support, ticket, 'Confirm', plan), /not allowed/i)
    await refused(take(w.contact, ticket, 'Confirm', { fix_what: 'Door number', fix_where: 'SAP plant master' }), /Target date is required/)
    await refused(take(w.contact, ticket, 'Confirm', { ...plan, target_date: '10-Nov-2026' }), /Target date must be a date/)
    await refused(take(w.contact, ticket, 'Confirm', { ...plan, question: 'x' }), /Confirm does not record/)
    await refused(take(w.contact, ticket, 'Mark fixed', { what_changed: 'x' }), /not an action from Raised/)
    ticket = await take(w.contact, ticket, 'Confirm', plan)
    expect(ticket.ticket_state).toBe('Fix planned')
    const seen = await read(w.raiser, 'detail', { row_id: ticket.row_id })
    expect(seen.details).toMatchObject({ ...plan, current_value: '78/499/1' })
    await refused(take(w.raiser, ticket, 'Mark fixed', { what_changed: 'x' }), /not allowed/i)
    ticket = await take(w.contact, ticket, 'Mark fixed', { what_changed: 'Corrected door number in plant 1100' })
    expect(ticket.ticket_state).toBe('Fixed: to verify')
    // The raiser or a verifier role; never the assignee who made the fix.
    expect(await offered(w.raiser, ticket)).toEqual(['Verify', 'Not fixed'])
    expect(await offered(w.verifier, ticket)).toEqual(['Verify'])
    expect(await offered(w.contact, ticket)).toEqual([])
    await refused(take(w.contact, ticket, 'Verify'), /not allowed/i)
    ticket = await take(w.raiser, ticket, 'Not fixed', { still_wrong: 'Plant 1200 still shows both numbers' })
    expect(ticket.ticket_state).toBe('Fix planned')
    ticket = await take(w.contact, ticket, 'Mark fixed', { what_changed: 'Plant 1200 corrected too' })
    ticket = await take(w.verifier, ticket, 'Verify')
    expect(ticket.ticket_state).toBe('Closed')
    expect((await read(w.support, 'queue', { state: 'open' })).tickets.map((t: Ticket) => t.row_id)).not.toContain(ticket.row_id)
    expect((await read(w.raiser, 'detail', { row_id: ticket.row_id })).details.what_changed).toBe('Plant 1200 corrected too')
  }, 30_000) // walks one ticket through its whole life, about 35 requests

  test('history records who took which action with its values; a private type shows others only the action', async ({ admin, createUser }) => {
    const w = await world(admin, createUser, 'private')
    let ticket = await raise(w)
    ticket = await take(w.contact, ticket, 'Ask a question', { question: 'Which plant?' })
    expect(ticket.ticket_state).toBe('Waiting for raiser')
    expect(await offered(w.contact, ticket)).toEqual([])
    expect((await read(w.raiser, 'detail', { row_id: ticket.row_id })).details.question).toBe('Which plant?')
    ticket = await take(w.raiser, ticket, 'Answer', { answer: 'Plant 1100' })
    expect(ticket.ticket_state).toBe('Raised')
    const events = (await read(w.support, 'detail', { row_id: ticket.row_id })).privateEvents
      .filter((e: any) => e.operation === 'transition').map((e: any) => ({ by: e.by, ...JSON.parse(e.text) }))
    expect(events).toEqual([
      { by: w.contact.user, action: 'Ask a question', from: 'Raised', to: 'Waiting for raiser', values: { question: 'Which plant?' } },
      { by: w.raiser.user, action: 'Answer', from: 'Waiting for raiser', to: 'Raised', values: { answer: 'Plant 1100' } },
    ])
    const shared = await read(w.colleague, 'detail', { row_id: ticket.row_id })
    expect(shared.events.map((e: any) => [e.by, e.text])).toEqual([
      [w.contact.user, 'Ask a question: Raised → Waiting for raiser'], [w.raiser.user, 'Answer: Waiting for raiser → Raised']])
    expect(JSON.stringify(shared)).not.toContain('Plant 1100')
    // Reject is a done state; the raiser reopens it.
    ticket = await take(w.contact, ticket, 'Reject', { rejection_reason: 'Not a data problem' })
    expect(ticket.ticket_state).toBe('Rejected')
    await refused(take(w.contact, ticket, 'Reopen'), /not allowed/i)
    ticket = await take(w.raiser, ticket, 'Reopen')
    expect(ticket.ticket_state).toBe('Raised')
  })

  test('a type with transitions refuses every other change of state; a stale revision is refused', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await raise(w)
    await refused(act(w.support, 'edit', { ...revision(ticket), state: 'Closed' }), /actions/)
    await refused(act(w.support, 'resolve', { ...revision(ticket), state: 'Closed', reason: 'r', reference: 'x' }), /actions/)
    await refused(act(w.support, 'edit', { ...revision(ticket), details: { fix_what: 'x' } }), /recorded by an action/)
    await refused(save(w.support, 'tickets.ticket', { ...ticket, ticket_state: 'Closed' }))
    // Reclassifying to a type without actions cannot be used to skip them (Codex review).
    await save(admin, 'tickets.ticket_type', { type_key: 'plain_issue', label: 'Plain issue', enabled: true, states: 'Raised\nClosed', done_states: 'Closed' })
    await refused(act(w.support, 'edit', { ...revision(ticket), kind: 'plain_issue', state: 'Closed' }), /actions/)
    await refused(act(w.support, 'edit', { ...revision(ticket), kind: 'plain_issue' }), /keeps its type/)
    // Support may still triage: reassign and edit the intake fields.
    const edited = (await act(w.support, 'edit', { ...revision(ticket), assigned_to: w.support.user, details: { current_value: '78/499' } })).ticket as Ticket
    expect(edited.ticket_state).toBe('Raised')
    await refused(take(w.contact, ticket, 'Confirm', plan), /changed/)
    expect(await offered(w.support, edited)).toEqual(['Confirm', 'Ask a question', 'Reject'])
    const confirmed = await take(w.support, edited, 'Confirm', plan)
    expect(confirmed.ticket_state).toBe('Fix planned')
    expect((await read(w.support, 'detail', { row_id: ticket.row_id })).details).toMatchObject({ current_value: '78/499', ...plan })
    // Support as assignee is still not the raiser.
    const fixed = await take(w.support, confirmed, 'Mark fixed', { what_changed: 'x' })
    await refused(take(w.support, fixed, 'Not fixed', { still_wrong: 'x' }), /not allowed/i)
  })

  test('a switched-off type is not offered for new tickets, and its tickets still move only through its actions', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await raise(w)
    const row = (await admin.get<any>(`/api/table/tickets.ticket_type/${w.dq.row_id}`))
    await save(admin, 'tickets.ticket_type', { ...row, enabled: false })
    expect((await read(w.raiser, 'form')).types.find((t: any) => t.key === 'data_quality_issue')).toMatchObject({ enabled: false })
    await refused(act(w.raiser, 'create', { title: 't', original: 'o', kind: 'data_quality_issue', details: { source_system: w.sap } }))
    await refused(act(w.support, 'resolve', { ...revision(ticket), reason: 'r', reference: 'x' }), /actions/)
    expect(await offered(w.contact, ticket)).toEqual(['Confirm', 'Ask a question', 'Reject'])
    expect((await take(w.contact, ticket, 'Confirm', plan)).ticket_state).toBe('Fix planned')
  })

  test('"any" is anyone involved, never a colleague who only sees the summary', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const row = (await admin.get<any>(`/api/table/tickets.ticket_type/${w.dq.row_id}`))
    await save(admin, 'tickets.ticket_type', { ...row, transitions: JSON.stringify([...dataQualityTransitions,
      { state: 'Raised', action: 'Withdraw', next_state: 'Rejected', allowed: 'any' }]) })
    const ticket = await raise(w)
    expect(await offered(w.raiser, ticket)).toEqual(['Withdraw'])
    expect(await offered(w.support, ticket)).toEqual(['Withdraw'])
    await refused(take(w.colleague, ticket, 'Withdraw'), /not allowed/i)
    expect((await take(w.raiser, ticket, 'Withdraw')).ticket_state).toBe('Rejected')
  })

  test('a transition that asks for a link field offers the rows the caller may read', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const row = (await admin.get<any>(`/api/table/tickets.ticket_type/${w.dq.row_id}`))
    await save(admin, 'tickets.ticket_type', { ...row, transitions: JSON.stringify([...dataQualityTransitions,
      { state: 'Raised', action: 'Move to another system', next_state: 'Raised', allowed: 'assignee', fields: ['also_concerns'] }]) })
    await save(admin, 'tickets.type_field', { ticket_type: w.dq.row_id, field_order: 99, field_name: 'also_concerns', label: 'Also concerns', field_type: 'link', link_table: 'Example System', link_label: 'system_name' })
    const ticket = await raise(w)
    const move = (await read(w.contact, 'detail', { row_id: ticket.row_id })).actions.find((a: any) => a.action === 'Move to another system')
    expect(move.fields[0].options).toEqual([{ value: w.sap, label: 'SAP' }])
  })

  test('the transitions a System Manager writes are checked against the type', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const row = (await admin.get<any>(`/api/table/tickets.ticket_type/${w.dq.row_id}`))
    const attempt = (transitions: unknown) => save(admin, 'tickets.ticket_type', { ...row, transitions: JSON.stringify(transitions) })
    const one = dataQualityTransitions[0]
    await refused(attempt({ not: 'a list' }), /list/)
    await refused(attempt([{ ...one, state: 'Nowhere' }]), /Nowhere/)
    await refused(attempt([{ ...one, next_state: 'Nowhere' }]), /Nowhere/)
    await refused(attempt([{ ...one, action: '' }]), /action/)
    await refused(attempt([{ ...one, allowed: '' }]), /allowed/)
    await refused(attempt([{ ...one, condition: 'row.x == 1' }]), /condition/)
    await refused(attempt([{ ...one, fields: 'fix_what' }]), /fields/)
    await refused(attempt([one, one]), /twice/)
    await refused(attempt([one, { ...one, allowed: 'requester', next_state: 'Closed' }]), /same next state/)
    await refused(save(admin, 'tickets.ticket_type', { type_key: 'broken_json', label: 'Broken', states: 'Open', transitions: '[' }), /list/)
    // Clearing the transitions gives the type back its old behaviour.
    await save(admin, 'tickets.ticket_type', { ...row, transitions: '' })
    const ticket = await raise(w)
    expect((await act(w.support, 'edit', { ...revision(ticket), state: 'Closed' })).ticket.ticket_state).toBe('Closed')
    expect(await offered(w.contact, ticket)).toEqual([])
  })
})
