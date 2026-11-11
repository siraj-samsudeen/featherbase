// #1196: the refusals and edges of Tickets' data quality rules, and the
// runtime count, beyond the spec's scenarios (test/scenarios/).
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { test as pgTest } from './pg-test'
import { callerDocuments } from '../src/runtime-actions'
import { discoverPackages } from '../src/runtime-packages'
import { BUYER_BLANK, pinning, TicketRules, Tickets } from './tickets-world'

const test = pgTest.extend(pinning)
const world = async (admin: ConstructorParameters<typeof Tickets>[0], createUser: ConstructorParameters<typeof Tickets>[1]) => {
  const x = new TicketRules(new Tickets(admin, createUser))
  await x.raised()
  return x
}

describe('adding a rule refuses what it cannot check (#1196)', () => {
  test('conditions must be 1 to 10 well-formed [column, operator, value]', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    for (const [filters, message] of [
      ['person is blank', /1 to 10 conditions/],
      [[], /1 to 10 conditions/],
      [Array.from({ length: 11 }, () => ['person', 'is blank', null]), /1 to 10 conditions/],
      [[['person', 'is blank']], /Each condition is/],
      [[['', '=', 'x']], /Each condition is/],
      [[['person', 'related', {}]], /operator is one of/],
    ] as [unknown, RegExp][]) {
      await x.add({ ...BUYER_BLANK, filters }, 'Bala', true)
      x.refusedWith(message)
    }
    expect(await x.rules()).toEqual([])
  })

  test('severity, owner and a stale ticket are checked', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    await x.add({ ...BUYER_BLANK, severity: 'Urgent' }, 'Bala', true)
    x.refusedWith(/Severity is one of: High, Medium, Low/)
    await x.add({ ...BUYER_BLANK, owner: x.t.ids.Colleague }, 'Bala', true)
    x.refusedWith(/one of the people Tickets assigns work to/)
    const stale = x.t.ticket
    await x.add({ ...BUYER_BLANK, owner: x.t.ids.Support, how_to_fix: '' })
    x.t.ticket = stale
    await x.add({ ...BUYER_BLANK, title: 'Again' }, 'Bala', true)
    x.refusedWith(/This ticket changed/)
    expect(await x.rules()).toMatchObject([{ owner: x.t.ids.Support, how_to_fix: null }])
  })

  test('the raiser who may not read the Table is told so', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    await x.add(BUYER_BLANK, 'Anjali', true)
    x.refusedWith(/You may not read Buyer Assignment/)
  })

  test('a ticket holds at most 25 rules', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    for (let i = 1; i <= 25; i++) await x.add({ ...BUYER_BLANK, title: `Rule ${String(i).padStart(2, '0')}` })
    await x.add({ ...BUYER_BLANK, title: 'Rule 26' }, 'Bala', true)
    x.refusedWith(/at most 25 rules/)
    expect(await x.rules()).toHaveLength(25)
  })
})

describe('a rule leaves its ticket only through remove_rule (#1196)', () => {
  test('someone not involved, or a rule of another ticket, is refused', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    await x.add()
    x.rule = (await x.rules())[0]
    await x.remove('Not mine', 'Colleague', true)
    x.refusedWith(/may remove a rule/)
    const first = x.t.ticket
    await x.transitions.raise()
    await x.remove('Wrong ticket', 'Bala', true)
    x.refusedWith(/not on this ticket/)
    x.t.ticket = first
    expect(await x.rules()).toHaveLength(1)
  })

  test('the Admin UI cannot delete a rule', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    await x.add()
    const rule = (await admin.get<{ updated_at: string }>(`/api/table/tickets.data_quality_rule/${(await x.rules())[0].row_id}`))
    const response = await admin.fetch(`/api/table/tickets.data_quality_rule/${(await x.rules())[0].row_id}?updated_at=${encodeURIComponent(rule.updated_at)}`, { method: 'DELETE' })
    expect(response.status).not.toBe(200)
    expect(await response.text()).toMatch(/Remove a rule from its ticket, with a reason/)
    expect(await x.rules()).toHaveLength(1)
  })
})

describe('the ticket lists its rules open first, then by severity and title (#1196)', () => {
  test('counted open rules, then uncounted, then all clear; ties by severity, then title', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    await x.add({ ...BUYER_BLANK, title: 'B open low', severity: 'Low' })
    await x.add({ ...BUYER_BLANK, title: 'A open high', severity: 'High' })
    await x.add({ ...BUYER_BLANK, title: 'C open high', severity: 'High' })
    await x.add({ ...BUYER_BLANK, title: 'Cleared', severity: 'High', filters: [['store', '=', 'North']] })
    await x.add({ ...BUYER_BLANK, title: 'Unlinked later', table: x.transitions.types.systemsTable, filters: [['source_system', '=', 'SAP']] })
    await admin.post('/api/save_row', { table: x.table, row: { ...(await admin.get<object>(`/api/table/${encodeURIComponent(x.table)}/${x.rows[0].row_id}`)), store: 'Elsewhere' } })
    // Its Table is no longer linked to Tickets: it reads as uncounted, not as a failure.
    await x.t.configure({ linked_tables: [x.transitions.types.ownersTable, x.table] })
    const rules = await x.rules()
    expect(rules.map(r => [r.title, r.rows_left])).toEqual([
      ['A open high', 3], ['C open high', 3], ['B open low', 3], ['Unlinked later', null], ['Cleared', 0],
    ])
  })
})

describe('documents.count (#1196)', () => {
  test('counts the app\'s own Tables, refuses related filters, and lets a real failure through', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    await x.add()
    expect(await discoverPackages([resolve('../..', 'example-apps/tickets')])).toEqual([])
    const own = callerDocuments('tickets', ['tickets.data_quality_rule'], 'Administrator', [x.table])
    expect(await own.documents.count('tickets.data_quality_rule', [['ticket', '=', x.t.ticket.row_id]])).toBe(1)
    await own.close()
    const related = callerDocuments('tickets', [], 'Administrator', [x.table])
    await expect(related.documents.count(x.table, [['role', 'related', {}]])).rejects.toMatchObject({ message: 'Action counts do not support cross-table related filters' })
    await expect(related.close()).rejects.toBeDefined()
    const broken = callerDocuments('tickets', [], 'Administrator', [x.table])
    // Not a refusal of the caller or the filter: the database's own failure is not hidden as "no count".
    await expect(broken.documents.count(x.table, [['created_at', '>', 'not a date']])).rejects.toBeDefined()
    await expect(broken.close()).rejects.toBeDefined()
  })
})
