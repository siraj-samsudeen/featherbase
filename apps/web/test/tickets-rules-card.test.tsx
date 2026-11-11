// #1196: the Rules card beyond its spec scenarios: removing a rule, a reader
// who cannot count, the Add a rule form's edges and a browser that keeps nothing.
import { screen, waitFor, within } from '@testing-library/react'
import { describe, vi } from 'vitest'
import { BUYER_BLANK, pinning, TicketRules, Tickets } from 'server/test/tickets-world'
import { test as base, expect, type Session } from './pg-test'
import { openTickets, selectTicket, ticketOpens } from './tickets-page'

const test = base.extend(pinning)
const card = () => screen.getByRole('region', { name: 'Rules' })

async function openAs(x: TicketRules, name: string): Promise<{ session: Session }> {
  const { session } = await openTickets(x.t.people[name]!)
  await ticketOpens(selectTicket(session, x.t.ticket.row_id))
  return { session }
}

describe('the Rules card (#1196)', () => {
  test('a rule is removed with a reason, and Cancel keeps it', async ({ admin, createUser }) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await x.withRule()
    const { session } = await openAs(x, 'Bala')
    await session.within('.rules', (rules) => rules.clickButton('Remove Buyer is blank'))
    await session.within('.rules', (rules) => rules.clickButton('Cancel'))
    expect(within(card()).getByRole('button', { name: 'Remove Buyer is blank' })).toBeInTheDocument()
    await session
      .within('.rules', (rules) => rules.clickButton('Remove Buyer is blank'))
      .fillIn('Why remove it?', 'Raised on the wrong ticket')
      .clickButton('Remove rule')
      .until('the rule is gone', () => !screen.queryByText('Buyer is blank'))
    expect(card()).toHaveTextContent('No rules yet')
    expect(await x.rules()).toEqual([])
  })

  test('a raiser who cannot read the Table sees no live count, no link and no bar, in every layout', async ({ admin, createUser }) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await x.withRule()
    await x.add({ ...BUYER_BLANK, title: 'Store like North', filters: [['store', 'like', '%North%']], severity: 'High' })
    const { session } = await openAs(x, 'Anjali')
    await session.until('the Rules card shows', () => screen.queryByRole('region', { name: 'Rules' }))
    expect(card()).toHaveTextContent('No access (raised with 3)')
    expect(within(card()).queryByRole('link', { name: 'Open these rows →' })).toBeNull()
    expect(within(card()).queryByText(/still to fix/)).toBeNull()
    // Nothing was counted for her, so the card never claims all clear.
    expect(within(card()).queryByText('All clear')).toBeNull()
    await session.within('.rules', (rules) => rules.clickButton('Table'))
    const table = within(card()).getByRole('table')
    expect(table).toHaveTextContent('store like "%North%"')
    expect(table).toHaveTextContent('No access')
    await session.within('.rules', (rules) => rules.clickButton('Tiles'))
    expect(within(card()).queryByRole('progressbar')).toBeNull()
    // Two open rules: the next step says so in the plural, for those who can count them.
    await session.within('.rules', (rules) => rules.clickButton('List'))
    const bala = await openAs(x, 'Bala')
    await bala.session.clickButton('Workflow').within('.ticket-actions', (next) => next.assertText('2 rules still have rows to fix'))
  })

  test('Add a rule: no columns for an unreadable Table, an empty match, conditions added and removed, Cancel', async ({ admin, createUser }) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await x.raised()
    const anjali = (await openAs(x, 'Anjali')).session
    await anjali
      .within('.rules', (rules) => rules.clickButton('Add a rule'))
      .selectOption('Table', 'Buyer Assignment')
      // Anjali may not read the Table: she is told so, and offered no conditions to build.
      .within('.rules', (rules) => rules.assertText("You may not read Buyer Assignment, so its columns can't be offered"))
    expect(screen.queryByRole('combobox', { name: 'Column 1' })).toBeNull()
    await anjali.clickButton('Cancel').until('the form has closed', () => !screen.queryByRole('combobox', { name: 'Table' }))

    const bala = (await openAs(x, 'Bala')).session
    await bala
      .within('.rules', (rules) => rules.clickButton('Add a rule'))
      .selectOption('Table', 'Buyer Assignment')
      .until('the columns are offered', () => screen.queryByRole('option', { name: 'Role' }))
      .selectOption('Column 1', 'Role')
      .fillIn('Value 1', 'Nobody')
      .within('.rules', (rules) => rules.assertText('Matches no rows, so there is nothing to fix.'))
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled()
    await bala.clickButton('Add a condition').clickButton('Remove condition 2')
    expect(screen.queryByRole('combobox', { name: 'Column 2' })).toBeNull()
    await bala.selectOption('Operator 1', 'is not').within('.rules', (rules) => rules.assertText('Matches 5 rows'))
    await bala
      .fillIn('Title', 'Role is not Nobody')
      .selectOption('Owner', "The ticket's assignee")
      .fillIn('How to fix (optional)', 'Check each row')
      .clickButton('Save rule')
      .until('the rule is on the card', () => screen.queryByText('Role is not Nobody'))
    expect(await x.ruleNamed('Role is not Nobody')).toMatchObject({ owner: x.t.ids.Bala, how_to_fix: 'Check each row', rows_when_raised: 5 })
  })

  test('a browser that keeps nothing still shows and switches the layouts', async ({ admin, createUser }) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await x.withRule()
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => { if (key === 'tickets.rules.layout') throw new Error('blocked'); return null })
    const set = vi.spyOn(Storage.prototype, 'setItem')
    try {
      // The page's own keys (its token) still read; only the layout key is blocked.
      get.mockRestore()
      const { session } = await openAs(x, 'Bala')
      const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
      set.mockImplementation(() => { throw new Error('blocked') })
      await session.within('.rules', (rules) => rules.clickButton('Tiles'))
      expect(within(card()).getByRole('article', { name: 'Buyer is blank' })).toBeInTheDocument()
      blocked.mockRestore()
    } finally { set.mockRestore() }
    await waitFor(() => expect(within(card()).getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'true'))
  })

  test('someone not involved sees the rules but cannot add or remove one; no rules and not involved shows no card', async ({ admin, createUser }) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await x.raised()
    const first = (await openAs(x, 'Colleague')).session
    await first.assertText('Public progress')
    expect(screen.queryByRole('region', { name: 'Rules' })).toBeNull()
    await x.add()
    await openAs(x, 'Colleague')
    expect(within(card()).queryByRole('button', { name: 'Add a rule' })).toBeNull()
    expect(within(card()).queryByRole('button', { name: /Remove/ })).toBeNull()
  })
})
