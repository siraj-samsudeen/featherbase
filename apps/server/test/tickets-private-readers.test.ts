import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { expectRefused, grantRole, makeTable } from './fixtures'
import { discoverPackages } from '../src/runtime-packages'
import { callerDocuments } from '../src/runtime-actions'
import { sql } from '../src/db'

// #925: a private ticket's assignee and the person it is raised for read its
// request as its raiser does, and stop when they are no longer named.
const directory = resolve('../..', 'example-apps/tickets')
const { version } = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { version: string }
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': `tickets@${version}` },
}) }, client.token, client.user)
type Person = TestClient & { user: string }
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
type Ticket = { row_id: string; updated_at: string; owner: string; assigned_to?: string | null }
const act = async (client: TestClient, name: string, payload: object) =>
  (await client.post<any>(`/api/app_actions/tickets/${name}`, { idempotencyKey: randomUUID(), payload })).result
const detail = async (client: TestClient, ticket: Ticket) =>
  (await client.post<any>('/api/app_reads/tickets/detail', { payload: { row_id: ticket.row_id } })).result.answer
const revision = (ticket: Ticket) => ({ row_id: ticket.row_id, updated_at: ticket.updated_at })
const save = (admin: TestClient, table: string, row: object) => admin.post<any>('/api/save_row', { table, row })
const ORIGINAL = 'Two plants carry both door numbers'

async function world(admin: TestClient, createUser: CreateUserFn, visibility: 'everyone' | 'private' = 'private') {
  await discoverPackages([directory])
  await admin.post('/api/install_app', { name: 'tickets' })
  // The raiser picks the person a ticket is raised for, so may see people.
  await grantRole(admin, { role: 'Person Reader', table: 'Person', can_read: true })
  const person = (name: string, roles: string[] = []) => createUser({ email: `${name}@tickets.example.test`, fullName: name, roles }) as Promise<Person>
  const raiser = await person('raiser', ['Person Reader'])
  const support = await person('triager', ['Tickets Support'])
  const [assignee, next, raisedFor, otherFor, colleague] = [await person('assignee'), await person('next'), await person('ravi'), await person('meera'), await person('colleague')]
  const filters = encodeURIComponent(JSON.stringify([['row_id', '=', 'tickets.support_users']]))
  const current = (await admin.get<any>(`/api/table/App%20Setting?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`)).data[0]
  await save(admin, 'App Setting', { row_id: 'tickets.support_users', updated_at: current?.updated_at, value: JSON.stringify([support.user]) })
  const type = await save(admin, 'tickets.ticket_type', { type_key: 'data_quality_issue', label: 'Data Quality Issue', enabled: true,
    states: 'Raised\nClosed', done_states: 'Closed', details_visible_to: visibility })
  await save(admin, 'tickets.type_field', { ticket_type: type.row_id, field_order: 1, field_name: 'current_value', label: 'Current value', field_type: 'text' })
  await save(admin, 'tickets.type_field', { ticket_type: type.row_id, field_order: 2, field_name: 'raised_for', label: 'Raised for', field_type: 'person' })
  const raise = async (details: object = { current_value: '78/499/1', raised_for: raisedFor.user }) =>
    (await act(raiser, 'create', { title: 'Plant address is wrong', original: ORIGINAL, kind: 'data_quality_issue', details })).ticket as Ticket
  const assign = async (ticket: Ticket, to: Person | null) => (await act(support, 'edit', { ...revision(ticket), assigned_to: to?.user ?? null })).ticket as Ticket
  return { raiser, support, assignee, next, raisedFor, otherFor, colleague, raise, assign }
}
const shares = async (ticket: Ticket) =>
  (await sql`select person from share where share_table = 'tickets.request' and share_name = ${ticket.row_id} order by person`).map(r => String(r.person))

describe('Tickets: the assignee and raised-for person of a private ticket read it (#925)', () => {
  test('they read its details and earlier wordings as the raiser does; support\'s history and colleagues stay out', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    let ticket = await w.raise()
    ticket = await w.assign(ticket, w.assignee)
    ticket = (await act(w.raiser, 'edit', { ...revision(ticket), original: 'Both plants carry two door numbers' })).ticket
    for (const reader of [w.assignee, w.raisedFor]) {
      const seen = await detail(reader, ticket)
      expect(seen.details).toMatchObject({ current_value: '78/499/1', raised_for: w.raisedFor.user, original: 'Both plants carry two door numbers' })
      expect(seen.originalHistory.map((h: any) => h.text)).toEqual([ORIGINAL])
      // Support's own log stays with support, as it does for the raiser.
      expect(seen.privateEvents).toBeUndefined()
      expect((await detail(w.raiser, ticket)).privateEvents).toBeUndefined()
    }
    const outside = await detail(w.colleague, ticket)
    expect(outside.details).toBeUndefined()
    expect(JSON.stringify(outside)).not.toContain('78/499/1')
    // Nothing else of the ticket opens to them: only the Tickets screen reads it.
    await expectRefused(w.colleague.get(`/api/table/tickets.request/${ticket.row_id}`), 403)
  })

  test('a reassigned assignee and a person no longer raised for lose it; the new ones read it', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    let ticket = await w.assign(await w.raise(), w.assignee)
    ticket = await w.assign(ticket, w.next)
    expect((await detail(w.next, ticket)).details).toBeDefined()
    expect((await detail(w.assignee, ticket)).details).toBeUndefined()
    ticket = (await act(w.raiser, 'edit', { ...revision(ticket), details: { raised_for: w.otherFor.user } })).ticket
    expect((await detail(w.otherFor, ticket)).details.raised_for).toBe(w.otherFor.user)
    expect((await detail(w.raisedFor, ticket)).details).toBeUndefined()
    ticket = await w.assign(ticket, null)
    expect((await detail(w.next, ticket)).details).toBeUndefined()
    expect(await shares(ticket)).toEqual([w.otherFor.user])
  })

  test('an action that records who it is raised for moves the reading too', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const [type] = await sql`select row_id, updated_at from tickets.ticket_type where type_key = 'data_quality_issue'`
    await save(admin, 'tickets.ticket_type', { row_id: type.row_id, updated_at: type.updated_at,
      transitions: JSON.stringify([{ state: 'Raised', action: 'Hand to', next_state: 'Raised', allowed: 'requester', fields: ['raised_for'] }]) })
    let ticket = await w.raise({ current_value: '78/499/1' })
    ticket = (await act(w.raiser, 'transition', { ...revision(ticket), action: 'Hand to', values: { raised_for: w.raisedFor.user } })).ticket
    expect((await detail(w.raisedFor, ticket)).details.raised_for).toBe(w.raisedFor.user)
    ticket = (await act(w.raiser, 'transition', { ...revision(ticket), action: 'Hand to', values: { raised_for: w.otherFor.user } })).ticket
    expect((await detail(w.otherFor, ticket)).details.raised_for).toBe(w.otherFor.user)
    expect((await detail(w.raisedFor, ticket)).details).toBeUndefined()
  })

  test('the routed assignee reads it from the start, and the raiser is never shared their own ticket', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    await makeTable(admin, { name: 'Example System', title_column: 'system_name', columns: ['system_name'] })
    await makeTable(admin, { name: 'Example System Owner', columns: [
      { column_name: 'source_system', column_type: 'Reference', reference_table: 'Example System' }, 'person'] })
    await grantRole(admin, { role: 'All', table: ['Example System', 'Example System Owner'], can_read: true })
    const sap = await save(admin, 'Example System', { system_name: 'SAP' })
    await save(admin, 'Example System Owner', { source_system: sap.row_id, person: w.assignee.user })
    const filters = encodeURIComponent(JSON.stringify([['row_id', '=', 'tickets.linked_tables']]))
    const current = (await admin.get<any>(`/api/table/App%20Setting?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`)).data[0]
    await save(admin, 'App Setting', { row_id: 'tickets.linked_tables', updated_at: current?.updated_at, value: JSON.stringify(['Example System', 'Example System Owner']) })
    const [type] = await sql`select row_id, updated_at from tickets.ticket_type where type_key = 'data_quality_issue'`
    await save(admin, 'tickets.ticket_type', { row_id: type.row_id, updated_at: type.updated_at,
      routing: JSON.stringify({ field: 'source_system', table: 'Example System Owner', match: 'source_system', person: 'person' }) })
    await save(admin, 'tickets.type_field', { ticket_type: type.row_id, field_order: 3, field_name: 'source_system', label: 'Source system', field_type: 'link', link_table: 'Example System', link_label: 'system_name' })
    const ticket = await w.raise({ source_system: sap.row_id, raised_for: w.raiser.user })
    expect(ticket.assigned_to).toBe(w.assignee.user)
    expect((await detail(w.assignee, ticket)).details.source_system).toBe(sap.row_id)
    expect(await shares(ticket)).toEqual([w.assignee.user])
  })

  test('a type whose details are open to everyone shares nothing', async ({ admin, createUser }) => {
    const w = await world(admin, createUser, 'everyone')
    const ticket = await w.assign(await w.raise(), w.assignee)
    expect((await detail(w.colleague, ticket)).details.current_value).toBe('78/499/1')
    expect(await shares(ticket)).toEqual([])
  })

  test('setReaders is for rows of the app\'s own Tables the caller reads, keeps only enabled people, and leaves other shares', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await w.raise({ current_value: 'x' })
    const docs = (person: Person, tables = ['tickets.request']) => callerDocuments('tickets', tables, person.user).documents
    // Someone who cannot read the row cannot name its readers.
    await expect(docs(w.colleague).setReaders('tickets.request', ticket.row_id, [w.colleague.user])).rejects.toMatchObject({ type: 'PermissionError' })
    await makeTable(admin, { name: 'Example Elsewhere', columns: ['label'] })
    const other = await save(admin, 'Example Elsewhere', { label: 'x' })
    await expect(docs(w.support, ['Example Elsewhere']).setReaders('Example Elsewhere', other.row_id, [w.next.user])).rejects.toThrow(/owned rows/)
    await expect(docs(w.support).setReaders('tickets.request', ticket.row_id, [''])).rejects.toThrow(/Person IDs/)
    await sql`update person set enabled = false where row_id = ${w.otherFor.user}`
    // A share that lets someone change the row is not the app's to take away.
    await sql`insert into share (row_id, share_table, share_name, person, read, write) values ('shr-925', 'tickets.request', ${ticket.row_id}, ${w.colleague.user}, true, true)`
    await docs(w.support).setReaders('tickets.request', ticket.row_id, [w.next.user, w.next.user, w.otherFor.user, 'psn_nope'])
    expect(await shares(ticket)).toEqual([w.colleague.user, w.next.user].sort())
    const [logged] = await sql`select operation from activity_log where operation like ${`row_readers_set tickets.request ${ticket.row_id}%`}`
    expect(logged.operation).toMatch(/\+1 -0$/)
    expect(await docs(w.next).isReader('tickets.request', ticket.row_id)).toBe(true)
    expect(await docs(w.colleague).isReader('tickets.request', ticket.row_id)).toBe(false)
    expect(await docs(w.raiser).isReader('tickets.request', ticket.row_id)).toBe(false)
    await docs(w.support).setReaders('tickets.request', ticket.row_id, [])
    expect(await shares(ticket)).toEqual([w.colleague.user])
    // Setting the same readers again changes and records nothing.
    await docs(w.support).setReaders('tickets.request', ticket.row_id, [])
    expect((await sql`select 1 from activity_log where operation like ${`row_readers_set tickets.request ${ticket.row_id}%`}`).length).toBe(2)
  })

  test('isReader answers false once the row no longer reads for that person', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await w.assign(await w.raise(), w.assignee)
    const docs = () => callerDocuments('tickets', ['tickets.request'], w.assignee.user).documents
    expect(await docs().isReader('tickets.request', ticket.row_id)).toBe(true)
    await sql`delete from tickets.request where row_id = ${ticket.row_id}`
    expect(await docs().isReader('tickets.request', ticket.row_id)).toBe(false)
  })
})
