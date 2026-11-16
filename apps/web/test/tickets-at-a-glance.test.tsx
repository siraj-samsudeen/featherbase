// #1233: Tickets' ticket page and list read at a glance. Tickets' own page in jsdom against the
// in-process server. jsdom has no media queries, so phone width is checked by the classes its CSS reads.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe } from 'vitest'
import { pinning, TicketCoveredRows, Tickets } from 'server/test/tickets-world'
import { test as base, expect } from './pg-test'
import { openTickets, selectTicket, ticketOpens } from './tickets-page'

const test = base.extend(pinning)
// jsdom draws nothing, so it has no scrolling; a header action scrolls to the form it opens.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
const header = () => screen.getByRole('banner', { name: 'Ticket' })
const actions = () => within(header()).getByRole('group', { name: 'Actions on this ticket' })

async function open(t: Tickets, actor: string, id = t.ticket.row_id) {
  const { session } = await openTickets(t.people[actor]!)
  await ticketOpens(selectTicket(session, id))
  return session
}

describe('the ticket page reads at a glance (#1233)', () => {
  test('one primary action for the next state, Add note beside it, the rest under More, each still opening its form', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await open(t, 'Support')
    const shown = within(actions()).getAllByRole('button').filter(b => !b.closest('[role=menu]'))
    expect(shown.map(b => b.textContent)).toEqual(['Resolve ticket', 'Add note', 'More ▾'])
    expect(shown[0]).toHaveClass('primary')
    expect(shown.slice(1).every(b => b.classList.contains('secondary'))).toBe(true)
    expect(within(actions()).queryByRole('menu')).toBeNull()
    fireEvent.click(within(actions()).getByRole('button', { name: 'More ▾' }))
    const menu = within(actions()).getByRole('menu', { name: 'More actions' })
    expect(within(menu).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Edit request', 'Correct the wording', 'Record evidence', 'Link work'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Link work' }))
    expect(within(actions()).queryByRole('menu')).toBeNull()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true'))
    expect(document.getElementById('action-link')).not.toBeNull()
  })

  test('the title carries its state beside it, and a ticket covering rows says how many in its facts', async ({ admin, createUser }) => {
    const x = new TicketCoveredRows(new Tickets(admin, createUser))
    await x.world()
    await open(x.t, 'Anjali')
    const title = within(header()).getByRole('heading', { level: 2 })
    expect(title.parentElement).toHaveClass('ticket-title-row')
    expect(within(title.parentElement!).getByText(x.t.ticket.ticket_state)).toBeInTheDocument()
    const rows = within(header()).getByRole('button', { name: '3 rows · 1 fixed' })
    fireEvent.click(rows)
    expect(screen.getByRole('tab', { name: 'Request' })).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('covered-rows')).not.toBeNull()
  })
})

describe('the assignee reads as a name (#1233)', () => {
  test('support sees the name with a quiet Change that opens the picker; Cancel puts the name back', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await t.action('edit', { assigned_to: t.ids.Bala }, 'Support')
    await open(t, 'Support')
    expect(within(header()).queryByRole('combobox', { name: 'Assigned to' })).toBeNull()
    // Names arrive with the ticket's read; wait for it rather than racing it.
    await waitFor(() => expect(within(header()).getByText('Bala')).toBeInTheDocument())
    fireEvent.click(within(header()).getByRole('button', { name: 'Change the assignee' }))
    expect(within(header()).getByRole('combobox', { name: 'Assigned to' })).toBeInTheDocument()
    fireEvent.click(within(header()).getByRole('button', { name: 'Cancel' }))
    expect(within(header()).queryByRole('combobox', { name: 'Assigned to' })).toBeNull()
  })
})

describe('the ticket list reads at a glance (#1233)', () => {
  test('each line: the summary, then ID · type · assignee, and its state', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await t.action('edit', { assigned_to: t.ids.Bala }, 'Support')
    await open(t, 'Support')
    const line = within(screen.getByLabelText('Tickets')).getAllByRole('button').find(b => b.textContent?.includes('Invoices cleared'))!
    expect(line.querySelector('.ticket-title')?.textContent).toContain('Invoices cleared two days ago')
    expect(line.querySelector('.ticket-meta')?.textContent).toMatch(/^FT-\d+ · Stale \/ missing data · Bala$/)
    expect(line.querySelector('.pill')).not.toBeNull()
  })

  test('at phone width the list shows first; opening a ticket shows it, and "All tickets" goes back', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    const session = await open(t, 'Support')
    const split = document.querySelector('.split')!
    expect(split).toHaveClass('phone-ticket')
    fireEvent.click(screen.getByRole('button', { name: '← All tickets' }))
    expect(split).toHaveClass('phone-list')
    void session
  })
})

describe('Edit request sits in its own form with Cancel beside Save (#1233)', () => {
  test('Cancel closes the form and drops what was typed', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await open(t, 'Support')
    fireEvent.click(within(actions()).getByRole('button', { name: 'More ▾' }))
    fireEvent.click(within(actions()).getByRole('menuitem', { name: 'Edit request' }))
    const form = await waitFor(() => document.getElementById('action-edit')!)
    const buttons = within(form).getAllByRole('button').map(b => b.textContent)
    expect(buttons.slice(-2)).toEqual(['Cancel', 'Save request'])
    expect(screen.queryByRole('button', { name: 'Cancel editing' })).toBeNull()
    fireEvent.change(within(form).getByLabelText('Public subject'), { target: { value: 'Typed then abandoned' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(document.getElementById('action-edit')).toBeNull()
    fireEvent.click(within(actions()).getByRole('button', { name: 'More ▾' }))
    fireEvent.click(within(actions()).getByRole('menuitem', { name: 'Edit request' }))
    const again = await waitFor(() => document.getElementById('action-edit')!)
    expect((within(again).getByLabelText('Public subject') as HTMLInputElement).value).not.toBe('Typed then abandoned')
  })
})

describe('Assigned to me speaks to support (#1233)', () => {
  test('an empty "Assigned to me" says nothing is assigned, and its filter starts on open work', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    const { session } = await openTickets(t.people.Support!)
    void session
    fireEvent.click([...document.querySelectorAll('featherbase-sidebar > button')].find(b => /Assigned to me/.test(b.textContent ?? ''))!)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Nothing assigned to you right now' })).toBeInTheDocument())
    expect(screen.getByText('Tickets assigned to you show here until they are done.')).toBeInTheDocument()
    expect(screen.queryByText('Create a request when you need a hand.')).toBeNull()
    expect((screen.getByRole('combobox', { name: 'Filter by state' }) as HTMLSelectElement).selectedOptions[0].textContent).toBe('Open work')
  })

  test('an empty "My requests" speaks to the person who raises them', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await openTickets(t.people.Support!)
    fireEvent.click([...document.querySelectorAll('featherbase-sidebar > button')].find(b => /My requests/.test(b.textContent ?? ''))!)
    await waitFor(() => expect(screen.getByRole('heading', { name: "You haven't raised a ticket yet" })).toBeInTheDocument())
    expect(screen.getByText('Create a request when you need a hand.')).toBeInTheDocument()
  })
})
