// #1194: a Table built on an instance cites tickets through a text column, so a
// ticket's Map and Tree (both read :connections) miss its rows. #911's "Turn
// into a link" is the fix: refused while a row names no ticket, then in place.
import { expect } from 'vitest'
import { test as pgTest } from './pg-test'
import { expectStatus } from './fixtures'
import { pinning, Tickets } from './tickets-world'

const test = pgTest.extend(pinning)
const ROWS = 'Tcr Affected Row'
const TICKET = 'tickets.ticket'
const STRAY = 'DQ-0078'

const ticketColumn = (type: 'Data' | 'Reference') =>
  ({ column_name: 'ticket', label: 'Ticket', column_type: type, reqd: true, ...(type === 'Reference' ? { reference_table: TICKET } : {}) })
const affected = { column_name: 'affected_row', label: 'Affected row', column_type: 'Data' }

async function world(admin: Tickets['admin'], createUser: ConstructorParameters<typeof Tickets>[1]) {
  const t = new Tickets(admin, createUser)
  await t.access()
  const ticket = t.ticket.row_id
  await admin.post('/api/table_def', { name: ROWS, columns: [ticketColumn('Data'), affected] })
  for (const [cites, row] of [[ticket, 'Plant 1100'], [ticket, 'Plant 1200'], [STRAY, 'Plant 1300']])
    await admin.post('/api/save_row', { table: ROWS, row: { ticket: cites, affected_row: row } })
  return ticket
}

const turnIntoLink = (admin: Tickets['admin']) =>
  admin.fetch(`/api/table_def/${encodeURIComponent(ROWS)}`, {
    method: 'PUT', body: JSON.stringify({ columns: [ticketColumn('Reference'), affected] }),
  })

/** What a ticket's Map and Tree list: the Tables whose rows link to it, with counts. */
const cited = async (admin: Tickets['admin'], ticket: string) =>
  (await admin.get<{ connections: { table: string; column: string; count: number }[] }>(
    `/api/table/${encodeURIComponent(TICKET)}/${encodeURIComponent(ticket)}:connections`)).connections.filter(c => c.table === ROWS)

const rows = async (admin: Tickets['admin']) =>
  (await admin.get<{ data: { row_id: string; updated_at: string; ticket: string; affected_row: string }[] }>(
    `/api/table/${encodeURIComponent(ROWS)}?fields=${encodeURIComponent(JSON.stringify(['row_id', 'updated_at', 'ticket', 'affected_row']))}&order_by=affected_row`)).data

test("while one row names no ticket the link is refused, naming it, and the ticket's Map lists none", async ({ admin, createUser }) => {
  const ticket = await world(admin, createUser)
  expect(await cited(admin, ticket)).toEqual([])
  const response = await turnIntoLink(admin)
  await expectStatus(response, 417)
  const { error } = await response.json() as { error: { fields: Record<string, string> } }
  expect(error.fields.ticket).toBe(`${STRAY} names no ${TICKET} row`)
  expect((await rows(admin)).map(r => r.ticket)).toEqual([ticket, ticket, STRAY])
  expect(await cited(admin, ticket)).toEqual([])
})

test("once that row names its ticket the column becomes a link in place, and the ticket's Map lists every row", async ({ admin, createUser }) => {
  const ticket = await world(admin, createUser)
  const stray = (await rows(admin)).find(r => r.ticket === STRAY)!
  await admin.post('/api/save_row', { table: ROWS, row: { row_id: stray.row_id, updated_at: stray.updated_at, ticket } })
  await expectStatus(await turnIntoLink(admin), 200)
  expect((await rows(admin)).map(r => [r.ticket, r.affected_row]))
    .toEqual([[ticket, 'Plant 1100'], [ticket, 'Plant 1200'], [ticket, 'Plant 1300']])
  expect(await cited(admin, ticket)).toMatchObject([{ table: ROWS, column: 'ticket', count: 3 }])
  const history = await admin.get<{ versions: unknown[] }>(`/api/activity/${encodeURIComponent(ROWS)}/${stray.row_id}`)
  expect(JSON.stringify(history.versions)).toContain(STRAY)
})
