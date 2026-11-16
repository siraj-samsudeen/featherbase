// tickets-data-quality-rules (#1196), the scenarios a person takes on Tickets'
// own page, rendered in jsdom against the real in-process server; the rest
// are in apps/server/test/scenarios/.
import { screen, within } from '@testing-library/react'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { BUYER_BLANK, pinning, TicketCoveredRows, TicketRules, Tickets } from 'server/test/tickets-world'
import { test as base, expect, type Session } from '../pg-test'
import { openTickets, selectTicket, ticketOpens } from '../tickets-page'

const test = base.extend(pinning)
const scenario = scenarioFor(test, 'tickets-data-quality-rules')
const WITH_RULE = 'a ticket with the rule "Buyer is blank" and 3 of 3 rows left'
const card = () => screen.getByRole('region', { name: 'Rules' })

// In an object: a Session is thenable, so an async function returning it bare would run it.
async function openAs(x: TicketRules, name: string): Promise<{ session: Session }> {
  const { session } = await openTickets(x.t.people[name]!)
  await ticketOpens(selectTicket(session, x.t.ticket.row_id))
  await session.until('the Rules card shows', () => screen.queryByRole('region', { name: 'Rules' }))
  return { session }
}

describe('tickets-data-quality-rules', () => {
  scenario('Bala sees the open rule first', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step('a ticket with the rules "Buyer is blank" (Medium, 3 of 3 rows left) and "Store is blank" (High, all clear)', async () => {
      await x.withRule()
      const row = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: x.table, row: { role: 'Buyer', person: 'Zed' } })
      await x.add({ title: 'Store is blank', table: x.table, severity: 'High', filters: [['store', 'is blank', null]] })
      await admin.post('/api/save_row', { table: x.table, row: { row_id: row.row_id, updated_at: row.updated_at, store: 'North' } })
    })
    await step('Bala opens the ticket', () => openAs(x, 'Bala'))
    await step('the Rules card lists "Buyer is blank" before "Store is blank"', () => {
      const items = within(card()).getAllByRole('listitem').map(item => item.textContent ?? '')
      expect(items[0]).toContain('Buyer is blank')
      expect(items[0]).toContain('3 of 3 left')
      expect(items[1]).toContain('Store is blank')
      expect(items[1]).toContain('All clear (was 1)')
    })
    await step('it reads "3 rows still to fix"', () => {
      expect(within(card()).getByRole('heading', { name: 'Rules · 2' })).toBeInTheDocument()
      expect(within(card()).getByText('3 rows still to fix')).toBeInTheDocument()
    })
  })

  scenario('A rule links to its matching rows', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step(WITH_RULE, () => x.withRule())
    await step('Bala opens the ticket', () => openAs(x, 'Bala'))
    await step('"Open these rows" points to the "Buyer Assignment" list filtered to role "Buyer" and person blank', async () => {
      const link = within(card()).getByRole('link', { name: 'Open these rows →' })
      const href = new URL(link.getAttribute('href')!, 'http://featherbase.test')
      expect(href.pathname).toBe('/featherbase/admin/table/buyer-assignment')
      const filters = JSON.parse(href.searchParams.get('filters')!)
      expect(filters).toEqual(BUYER_BLANK.filters)
      // The list that address opens: exactly the three blank buyers.
      const listed = await admin.get<{ data: { store: string }[] }>(`/api/table/${encodeURIComponent(x.table)}?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent('["store"]')}`)
      expect(listed.data.map(row => row.store).sort()).toEqual(['East', 'North', 'South'])
    })
  })

  scenario('Bala adds a rule from the ticket page', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    let session!: Session
    await step('Anjali raised a Data Quality Issue for SAP, assigned to Bala', () => x.transitions.raise())
    await step('the linked Table "Buyer Assignment" has 3 buyer rows whose person is blank', () => x.desk())
    await step('Bala picks "Buyer Assignment", role is "Buyer" and person is blank on the ticket page', async () => {
      ({ session } = await openAs(x, 'Bala'))
      await session
        .within('.rules', (rules) => rules.clickButton('Add a rule'))
        .selectOption('Table', 'Buyer Assignment')
        .until('the Table\'s columns are offered', () => screen.queryByRole('option', { name: 'Person' }))
        .selectOption('Column 1', 'Role')
        .fillIn('Value 1', 'Buyer')
        .clickButton('Add a condition')
        .selectOption('Column 2', 'Person')
        .selectOption('Operator 2', 'is blank')
    })
    await step('the page says it matches 3 rows', () => session.within('.rules', (rules) => rules.assertText('Matches 3 rows')))
    await step('when Bala saves it as "Buyer is blank", the Rules card shows it', async () => {
      await session
        .fillIn('Title', 'Buyer is blank')
        .clickButton('Save rule')
        .until('the rule is on the card', () => screen.queryByText('Buyer is blank'))
      expect(card()).toHaveTextContent('3 of 3 left')
      expect((await x.rules())[0]).toMatchObject({ title: 'Buyer is blank', rows_when_raised: 3, owner: x.t.ids.Bala })
    })
  })

  scenario('The rules can be shown as a table or tiles', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    let session!: Session
    await step(WITH_RULE, () => x.withRule())
    await step('Bala switches the Rules card to "Tiles"', async () => {
      localStorage.removeItem('tickets.rules.layout');
      ({ session } = await openAs(x, 'Bala'))
      expect(within(card()).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
      await session.within('.rules', (rules) => rules.clickButton('Table'))
      expect(within(card()).getByRole('table')).toHaveTextContent('Buyer is blank')
      await session.within('.rules', (rules) => rules.clickButton('Tiles'))
    })
    await step('the rule is shown as a tile', () => {
      expect(within(card()).getByRole('article', { name: 'Buyer is blank' })).toHaveTextContent('3 of 3 left')
      expect(within(card()).getByRole('progressbar', { name: 'Buyer is blank fixed' })).toHaveAttribute('aria-valuenow', '0')
    })
    await step('the ticket page opens with tiles next time', async () => {
      await openAs(x, 'Bala')
      expect(within(card()).getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'true')
      expect(within(card()).getByRole('article', { name: 'Buyer is blank' })).toBeInTheDocument()
    })
  })

  scenario('The next step warns while rules have rows to fix', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    let session!: Session
    await step(WITH_RULE, () => x.withRule())
    await step('Bala opens the ticket', async () => { ({ session } = await openAs(x, 'Bala')) })
    await step('the next step says "1 rule still has rows to fix"', async () => {
      await session.clickButton('Workflow').within('.ticket-actions', (next) => next.assertText('1 rule still has rows to fix'))
      // A warning, never a block: the move is still offered.
      expect(within(screen.getByRole('group', { name: 'Actions on this ticket' })).getByRole('button', { name: 'Confirm' })).toBeEnabled()
    })
  })
})

// #1230: the rows a ticket covers, as each viewer sees them on the Request tab.
describe('tickets-data-quality-rules: the rows a ticket covers', () => {
  const covered = () => screen.getByRole('region', { name: 'Rows this ticket covers' })
  async function openCovered(x: TicketCoveredRows, name: string) {
    const { session } = await openTickets(x.t.people[name]!)
    await ticketOpens(selectTicket(session, x.t.ticket.row_id))
    await session.until('the covered rows show', () => screen.queryByRole('region', { name: 'Rows this ticket covers' }))
    return { session }
  }

  scenario('A row links to its record only for someone who may read it', async ({ admin, createUser }, step) => {
    const x = new TicketCoveredRows(new Tickets(admin, createUser))
    await step('Anjali\'s Data Quality Issue covers the Section "North Grocery", which only Tickets support may read', () => x.world())
    await step('Bala opens the ticket', () => openCovered(x, 'Bala'))
    await step('"North Grocery" links to its Section record', () => {
      expect(within(covered()).getByText('3 rows · 1 fixed')).toBeInTheDocument()
      const link = within(covered()).getByRole('link', { name: 'North Grocery' })
      expect(link.getAttribute('href')).toBe('/featherbase/admin/table/section/row/North%20Grocery')
      expect(within(covered()).getByText('Fixed 07-Nov-2026')).toBeInTheDocument()
    })
    await step('when Anjali opens the ticket, "North Grocery" is plain text', async () => {
      await openCovered(x, 'Anjali')
      expect(within(covered()).queryByRole('link', { name: 'North Grocery' })).toBeNull()
      expect(within(covered()).getByText('North Grocery')).toBeInTheDocument()
    })
  })
})
