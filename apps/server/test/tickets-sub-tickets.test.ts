import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import type { TestClient, CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { pinning, TICKETS_DIRECTORY, type Ticket } from './tickets-world'

// #1397: a ticket may sit under a parent ticket, one level deep.
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>(pinning)
const act = async (client: TestClient, name: string, payload: object) =>
  (await client.post<any>(`/api/app_actions/tickets/${name}`, { idempotencyKey: randomUUID(), payload })).result
const read = async (client: TestClient, name: string, payload: object = {}) =>
  (await client.post<any>(`/api/app_reads/tickets/${name}`, { payload })).result.answer
async function refused(promise: Promise<unknown>, message: RegExp) {
  let failure: any
  try { await promise } catch (error) { failure = error }
  expect(failure, 'the write must be refused').toBeDefined()
  expect(JSON.stringify(failure.body ?? failure.message)).toMatch(message)
}
async function world(admin: TestClient, createUser: CreateUserFn) {
  await discoverPackages([TICKETS_DIRECTORY])
  await admin.post('/api/install_app', { name: 'tickets' })
  const raiser = await createUser({ email: 'raiser@tickets.example.test', fullName: 'Raiser' })
  const support = await createUser({ email: 'support@tickets.example.test', fullName: 'Support', roles: ['Tickets Support'] })
  const filters = encodeURIComponent(JSON.stringify([['row_id', '=', 'tickets.support_users']]))
  const current = (await admin.get<any>(`/api/table/App%20Setting?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`)).data[0]
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'tickets.support_users', updated_at: current?.updated_at, value: JSON.stringify([support.user]) } })
  const raise = async (title: string, parent?: string, client: TestClient = raiser) =>
    (await act(client, 'create', { title, original: `${title}, in full`, ...(parent ? { parent_ticket: parent } : {}) })).ticket as Ticket
  return { raiser, support, raise }
}

describe('Tickets: sub-tickets (#1397)', () => {
  test('the version step adds the parent column without rewriting released steps', async ({ admin, createUser }) => {
    await world(admin, createUser)
    const manifest = JSON.parse(await readFile(resolve(TICKETS_DIRECTORY, 'featherbase.json'), 'utf8'))
    const step = manifest.migrations.findIndex((m: any) => m.id === 'sub_tickets')
    expect(manifest.migrations[step - 1].id).toBe('no_refused_person_reads')
    expect(manifest.migrations[step]).toEqual({ id: 'sub_tickets', fromVersion: '0.2.22', toVersion: '0.2.23', operations: [
      { kind: 'addColumn', table: 'tickets.ticket', column: { column_name: 'parent_ticket', label: 'Part of', column_type: 'Reference', reference_table: 'tickets.ticket' } }] })
    expect((await sql`select column_name from information_schema.columns where table_schema = 'tickets' and table_name = 'ticket' and column_name = 'parent_ticket'`).length).toBe(1)
  })

  test('the queue shows a parent once, counting its sub-tickets; a search still finds one', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const umbrella = await w.raise('Accounts to link')
    const first = await w.raise('Link ea_kumar', umbrella.row_id)
    const second = await w.raise('Link ea_priya', umbrella.row_id)
    const third = await w.raise('Link ea_ravi', umbrella.row_id)
    const loose = await w.raise('Printer is jammed')
    expect(first.parent_ticket).toBe(umbrella.row_id)
    const done = (await read(w.support, 'detail', { row_id: second.row_id })).ticket
    await act(w.support, 'resolve', { row_id: done.row_id, updated_at: done.updated_at, reason: 'Linked', reference: 'Person set' })

    const queue = await read(w.support, 'queue')
    expect(queue.tickets.map((t: any) => t.row_id).sort()).toEqual([umbrella.row_id, loose.row_id].sort())
    expect(queue.count).toBe(2)
    expect(queue.tickets.find((t: any) => t.row_id === umbrella.row_id).sub_tickets).toEqual({ count: 3, open: 2 })
    expect(queue.tickets.find((t: any) => t.row_id === loose.row_id).sub_tickets).toBeUndefined()
    expect(queue.under).toEqual({ [first.row_id]: umbrella.row_id, [second.row_id]: umbrella.row_id, [third.row_id]: umbrella.row_id })

    const found = await read(w.support, 'queue', { search: 'ea_priya' })
    expect(found.tickets.map((t: any) => [t.row_id, t.parent_ticket])).toEqual([[second.row_id, umbrella.row_id]])

    const parentPage = await read(w.raiser, 'detail', { row_id: umbrella.row_id })
    // Open ones first, then done ones.
    expect(parentPage.children.map((t: any) => [t.row_id, t.ticket_state])).toEqual([
      [first.row_id, 'New'], [third.row_id, 'New'], [second.row_id, 'Resolved']])
    expect(parentPage.parent).toBeUndefined()
    const childPage = await read(w.raiser, 'detail', { row_id: third.row_id })
    expect(childPage.parent).toMatchObject({ row_id: umbrella.row_id, title: 'Accounts to link' })
    expect(childPage.children).toEqual([])
  })

  test('one level only, and never its own parent', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const umbrella = await w.raise('Accounts to link')
    const child = await w.raise('Link ea_kumar', umbrella.row_id)
    await refused(w.raise('Deeper', child.row_id), /sub-ticket cannot have sub-tickets/)
    await refused(w.raise('Nowhere', 'FT-99999'), /No ticket FT-99999/)
    const fresh = (await read(w.support, 'detail', { row_id: umbrella.row_id })).ticket
    await refused(act(w.support, 'edit', { row_id: fresh.row_id, updated_at: fresh.updated_at, parent_ticket: fresh.row_id }), /cannot be its own parent/)
    const other = await w.raise('Another umbrella')
    await refused(act(w.support, 'edit', { row_id: fresh.row_id, updated_at: fresh.updated_at, parent_ticket: other.row_id }), /has sub-tickets, so it cannot be one/)
  })

  test('support files a ticket under a parent and takes it out again; nobody else may', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const umbrella = await w.raise('Accounts to link')
    const loose = await w.raise('Link ea_kumar')
    await refused(act(w.raiser, 'edit', { row_id: loose.row_id, updated_at: loose.updated_at, parent_ticket: umbrella.row_id }), /Only support may/)
    const filed = (await act(w.support, 'edit', { row_id: loose.row_id, updated_at: loose.updated_at, parent_ticket: umbrella.row_id })).ticket
    expect(filed.parent_ticket).toBe(umbrella.row_id)
    expect((await read(w.support, 'queue')).tickets.map((t: any) => t.row_id)).toEqual([umbrella.row_id])
    const out = (await act(w.support, 'edit', { row_id: filed.row_id, updated_at: filed.updated_at, parent_ticket: null })).ticket
    expect(out.parent_ticket).toBeNull()
  })
})
