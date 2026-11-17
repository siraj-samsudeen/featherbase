// #1233: Tickets' ticket page and list read at a glance. Tickets' own page in jsdom against the
// in-process server. jsdom has no media queries, so phone width is checked by the classes its CSS reads.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, vi } from 'vitest'
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

// #1252: jsdom lays nothing out. Here a button is 8px a letter plus 20px, the actions row is `row` wide,
// and resize() plays the window being resized.
function layout(start: number) {
  let row = start
  const observed: ResizeObserverCallback[] = []
  vi.stubGlobal('ResizeObserver', class { constructor(cb: ResizeObserverCallback) { observed.push(cb) } observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.tagName === 'BUTTON' ? (this.textContent ?? '').length * 8 + 20 : 0 } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('header-actions') ? row : 0
  })
  return { resize: (width: number) => { row = width; act(() => { for (const cb of observed) cb([], {} as ResizeObserver) }) } }
}
const shownActions = () => within(actions()).getAllByRole('button').filter(b => !b.closest('[role=menu]')).map(b => b.textContent)

describe('the ticket page reads at a glance (#1233)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  // Resolve ticket 132, Add note 84, Edit request 116, Correct the wording 172, Record evidence 140, Link work 92,
  // More ▾ 68, 6px between: all six need 766.
  test('#1252: as many actions as fit show as buttons, in order; only the rest go under More, and a resize recounts', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    const { resize } = layout(800)
    await open(t, 'Support')
    resize(800)
    expect(shownActions()).toEqual(['Resolve ticket', 'Add note', 'Edit request', 'Correct the wording', 'Record evidence', 'Link work'])
    expect(within(actions()).queryByRole('button', { name: 'More ▾' })).toBeNull()
    resize(500)
    expect(shownActions()).toEqual(['Resolve ticket', 'Add note', 'Edit request', 'More ▾'])
    fireEvent.click(within(actions()).getByRole('button', { name: 'More ▾' }))
    const menu = within(actions()).getByRole('menu', { name: 'More actions' })
    expect(within(menu).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Correct the wording', 'Record evidence', 'Link work'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Link work' }))
    expect(within(actions()).queryByRole('menu')).toBeNull()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true'))
    expect(document.getElementById('action-link')).not.toBeNull()
    resize(1000)
    expect(shownActions()).toHaveLength(6)
  })

  test('the next state is the primary button; the others are secondary, and none shows twice', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    const { resize } = layout(300)
    await open(t, 'Support')
    resize(300)
    const shown = within(actions()).getAllByRole('button').filter(b => !b.closest('[role=menu]'))
    expect(shown[0]).toHaveTextContent('Resolve ticket')
    expect(shown[0]).toHaveClass('primary')
    expect(shown.slice(1).every(b => b.classList.contains('secondary'))).toBe(true)
    fireEvent.click(within(actions()).getByRole('button', { name: 'More ▾' }))
    const items = within(within(actions()).getByRole('menu')).getAllByRole('menuitem').map(b => b.textContent)
    const all = [...shown.map(b => b.textContent).filter(l => l !== 'More ▾'), ...items]
    expect(new Set(all).size).toBe(all.length)
    expect(all.filter(l => l === 'Add note')).toHaveLength(1)
  })

  test('the title carries its state beside it, and a ticket covering records says how many to fix in its facts', async ({ admin, createUser }) => {
    const x = new TicketCoveredRows(new Tickets(admin, createUser))
    await x.world()
    await open(x.t, 'Anjali')
    const title = within(header()).getByRole('heading', { level: 2 })
    expect(title.parentElement).toHaveClass('ticket-title-row')
    expect(within(title.parentElement!).getByText(x.t.ticket.ticket_state)).toBeInTheDocument()
    // #1252: "Rows" told a store user nothing; these are the records the ticket says are wrong.
    expect(within(header()).getByText('Records To Fix').tagName).toBe('DT')
    const records = within(header()).getByRole('button', { name: '3 · 1 fixed' })
    fireEvent.click(records)
    expect(screen.getByRole('tab', { name: 'Request' })).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('covered-rows')).not.toBeNull()
  })

  test('#1252: the table says records too: its title, its first column and its group lines', async ({ admin, createUser }) => {
    const x = new TicketCoveredRows(new Tickets(admin, createUser))
    await x.world()
    await open(x.t, 'Anjali')
    const table = await screen.findByRole('region', { name: 'Records this ticket covers' })
    expect(within(table).getByRole('heading', { name: 'Records this ticket covers' })).toBeInTheDocument()
    expect(within(table).getByText('3 records · 1 fixed')).toBeInTheDocument()
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Record', 'What Is Wrong', 'Fixed On'])
    expect(within(table).getAllByRole('rowheader').map(h => h.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/ · \d+ records? · \d+ fixed$/)]))
    // The page's own words, not the records' names (one is "Every buyer row with no person").
    const words = [table.querySelector('.covered-head'), ...within(table).getAllByRole('columnheader'), ...within(table).getAllByRole('rowheader')].map(el => el!.textContent)
    expect(words.filter(text => /\brows?\b/i.test(text ?? ''))).toEqual([])
    expect(within(table).getByRole('progressbar', { name: 'Records fixed' })).toBeInTheDocument()
  })

  test('#1252: short labels and headings are in Title Case; phrases stay in sentence case', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await open(t, 'Support')
    expect(within(header()).getAllByRole('term').map(dt => dt.textContent)).toEqual(['Raised By', 'Assigned To', 'Updated'])
    expect(screen.getByRole('heading', { name: 'Original Message' })).toBeInTheDocument()
    expect(screen.getByText(/^(Shown to everyone who can see the ticket|Private · requester and support)$/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Workflow' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Investigation Workflow' })).toBeInTheDocument())
  })
})

describe('an empty history says so plainly (#1252)', () => {
  test('each empty history reads "No activity yet.", its heading saying whose it is', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await open(t, 'Support')
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    const empty = await waitFor(() => {
      const found = screen.getAllByText(/activity yet/)
      expect(found.length).toBeGreaterThan(0)
      return found
    })
    expect(empty.map(p => p.textContent)).toEqual(empty.map(() => 'No activity yet.'))
  })
})

describe('the assignee reads as a name (#1233)', () => {
  test('support sees the name with a quiet Change that opens the picker; Cancel puts the name back', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await t.action('edit', { assigned_to: t.ids.Bala }, 'Support')
    await open(t, 'Support')
    expect(within(header()).queryByRole('combobox', { name: 'Assigned To' })).toBeNull()
    // Names arrive with the ticket's read; wait for it rather than racing it.
    await waitFor(() => expect(within(header()).getByText('Bala')).toBeInTheDocument())
    fireEvent.click(within(header()).getByRole('button', { name: 'Change the assignee' }))
    expect(within(header()).getByRole('combobox', { name: 'Assigned To' })).toBeInTheDocument()
    fireEvent.click(within(header()).getByRole('button', { name: 'Cancel' }))
    expect(within(header()).queryByRole('combobox', { name: 'Assigned To' })).toBeNull()
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
    fireEvent.click(within(actions()).getByRole('button', { name: 'Edit request' }))
    const form = await waitFor(() => document.getElementById('action-edit')!)
    const buttons = within(form).getAllByRole('button').map(b => b.textContent)
    expect(buttons.slice(-2)).toEqual(['Cancel', 'Save request'])
    expect(screen.queryByRole('button', { name: 'Cancel editing' })).toBeNull()
    fireEvent.change(within(form).getByLabelText('Public subject'), { target: { value: 'Typed then abandoned' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(document.getElementById('action-edit')).toBeNull()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Edit request' }))
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
