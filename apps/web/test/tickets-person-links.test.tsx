// #1301: the people on a ticket are links for a viewer who may open them and plain text for one who
// may not (#1230), and finding out never costs that viewer a refused request. Tickets' own page in jsdom
// against the in-process server.
import { waitFor } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { pinning, Tickets } from 'server/test/tickets-world'
import { grantRole } from 'server/test/fixtures'
import { test as base, expect } from './pg-test'
import { openTickets, selectTicket, ticketOpens } from './tickets-page'

const test = base.extend(pinning)
afterEach(() => vi.restoreAllMocks())

/** Every request the page makes that the server refuses (4xx or 5xx), from now on. */
function recordFailures(): string[] {
  const failures: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await real(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (response.status >= 400) failures.push(`${response.status} ${url}`)
    return response
  })
  return failures
}

async function open(t: Tickets, actor: string) {
  const { session } = await openTickets(t.people[actor]!)
  await ticketOpens(selectTicket(session, t.ticket.row_id))
}

/** How the ticket draws its requester: 'link' or 'text'. */
const requester = (t: Tickets) =>
  document.querySelector(`[data-table="Person"][data-row="${t.ids.Anjali}"]`)?.getAttribute('data-record-link')

test('a requester who may not read Person opens their ticket with no failing request', async ({ admin, createUser }) => {
  const t = new Tickets(admin, createUser)
  await t.complaint()
  const failures = recordFailures()
  await open(t, 'Anjali')
  await waitFor(() => expect(requester(t)).toBe('text'))
  // Long enough for a question about the people to have been answered.
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(failures).toEqual([])
})

test('the people on a ticket are plain text for a viewer who may not read Person', async ({ admin, createUser }) => {
  const t = new Tickets(admin, createUser)
  await t.complaint()
  await open(t, 'Anjali')
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(requester(t)).toBe('text')
})

test('the people on a ticket are links for a viewer granted read on Person', async ({ admin, createUser }) => {
  const t = new Tickets(admin, createUser)
  await t.complaint()
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Person Reader' } })
  await grantRole(admin, { role: 'Person Reader', table: 'Person', can_read: true })
  await t.person('Reader', ['Tickets Support', 'Person Reader'])
  await t.configure({ support_users: ['Support', 'Verifier', 'Bala', 'Karthik', 'Shiva', 'Fulfiller', 'Reader'].map((name) => t.ids[name]) })
  await open(t, 'Reader')
  await waitFor(() => expect(requester(t)).toBe('link'))
})

test('the people on a ticket are links for a System Manager', async ({ admin, createUser }) => {
  const t = new Tickets(admin, createUser)
  await t.complaint()
  await open(t, 'Administrator')
  await waitFor(() => expect(requester(t)).toBe('link'))
})
