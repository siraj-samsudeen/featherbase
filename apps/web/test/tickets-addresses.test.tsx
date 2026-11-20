// #1378: Tickets' address follows what is open (the view, the ticket, the
// New ticket form and the filters), so a copied address reopens it.
import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, describe } from 'vitest'
import { pinning, Tickets } from 'server/test/tickets-world'
import { test as base, expect } from './pg-test'
import { openTickets, selectTicket, sidebar, ticketOpens } from './tickets-page'

const test = base.extend(pinning)
const here = () => `${window.location.pathname}${window.location.search}`
const header = () => document.querySelector('header.ticket-header')?.textContent ?? ''

describe('Tickets keeps its address in step with what is open (#1378)', () => {
  afterEach(() => { window.history.replaceState(null, '', '/') })

  test('choosing a ticket names it in the address, and the address reopens it', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    const { session } = await openTickets(t.people.Support!)
    await ticketOpens(selectTicket(session, t.ticket.row_id))
    await waitFor(() => expect(window.location.pathname).toBe(`/tickets/all/${t.ticket.row_id}`))
    expect(new URLSearchParams(window.location.search).get('search')).toBe(t.ticket.row_id)

    // Pasted into a new tab, with no search: the same ticket opens.
    const reopened = await openTickets(t.people.Support!, `all/${t.ticket.row_id}`)
    await ticketOpens(reopened.session)
    await waitFor(() => expect(header()).toContain(String(t.ticket.title)))
    expect(here()).toBe(`/tickets/all/${t.ticket.row_id}`)
  })

  test('a view and the New ticket form have their own addresses, and Back walks them', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await openTickets(t.people.Support!)
    act(() => (sidebar().querySelector('button:nth-of-type(2)') as HTMLButtonElement).click())
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/tickets\/mine(\/|$)/))
    act(() => screen.getAllByRole('button', { name: /New ticket/ })[0]!.click())
    await waitFor(() => expect(window.location.pathname).toBe('/tickets/new'))
    act(() => { window.history.back() })
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/tickets\/mine(\/|$)/))
    expect(document.querySelector('dialog[open]')).toBeNull()
  })

  test('the filters are in the query, and an address with them opens filtered', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await openTickets(t.people.Support!, '?search=no-such-ticket-anywhere')
    expect(screen.getByRole('searchbox', { name: 'Search tickets' })).toHaveValue('no-such-ticket-anywhere')
    expect(await screen.findByText('No matching tickets')).toBeInTheDocument()
    expect(here()).toBe('/tickets/?search=no-such-ticket-anywhere')
  })
})
