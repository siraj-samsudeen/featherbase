import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import type { TestClient, CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { pinning, TICKETS_DIRECTORY, type Ticket } from './tickets-world'

// #1463: a ticket's details may carry `open: { label, href }`, a same-origin link to where its work is done.
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
  return { raiser, support }
}
const open = { label: 'Link in Featherbase', href: '/featherbase/admin/link-motherduck-accounts?account=md-1' }

describe('Tickets: a link to where the work is done (#1463)', () => {
  test('a ticket raised with an open link carries it; support adds one later and other details stay', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const raised = (await act(w.raiser, 'create', { title: 'Link ea_kumar', original: 'Link it', details: { account: 'md-1', open } })).ticket as Ticket
    expect((await read(w.raiser, 'detail', { row_id: raised.row_id })).details).toMatchObject({ account: 'md-1', open })

    const plain = (await act(w.raiser, 'create', { title: 'Printer', original: 'Jammed', details: { floor: '2' } })).ticket as Ticket
    const fresh = (await read(w.support, 'detail', { row_id: plain.row_id })).ticket
    await act(w.support, 'edit', { row_id: fresh.row_id, updated_at: fresh.updated_at, details: { open: { label: 'Open the printer page', href: '/printers/2' } } })
    expect((await read(w.support, 'detail', { row_id: plain.row_id })).details).toMatchObject({ floor: '2', open: { label: 'Open the printer page', href: '/printers/2' } })
  })

  test('only a relative /… path with a label is taken', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const raise = (link: unknown) => act(w.raiser, 'create', { title: 'T', original: 'O', details: { open: link } })
    for (const href of ['https://elsewhere.example/x', '//elsewhere.example/x', 'javascript:alert(1)', 'relative/path', '/\\elsewhere.example'])
      await refused(raise({ label: 'Go', href }), /relative path/)
    await refused(raise({ href: '/x' }), /label/)
    await refused(raise({ label: 'Go', href: '/x', extra: 1 }), /label and href/)
    await refused(raise('/x'), /label and href/)
  })

  test('a configured type keeps its link when a field is edited', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const type = await admin.post<any>('/api/save_row', { table: 'tickets.ticket_type', row: { type_key: 'linkable', label: 'Linkable', enabled: true,
      states: 'Raised\nDone', done_states: 'Done' } })
    await admin.post('/api/save_row', { table: 'tickets.type_field', row: { ticket_type: type.row_id, field_name: 'note', label: 'Note', field_type: 'text' } })
    const raised = (await act(w.raiser, 'create', { title: 'T', original: 'O', kind: 'linkable', details: { note: 'first', open } })).ticket as Ticket
    expect((await read(w.raiser, 'detail', { row_id: raised.row_id })).details).toMatchObject({ note: 'first', open })
    const fresh = (await read(w.support, 'detail', { row_id: raised.row_id })).ticket
    await act(w.support, 'edit', { row_id: fresh.row_id, updated_at: fresh.updated_at, details: { note: 'second' } })
    expect((await read(w.raiser, 'detail', { row_id: raised.row_id })).details).toMatchObject({ note: 'second', open })
  })
})
