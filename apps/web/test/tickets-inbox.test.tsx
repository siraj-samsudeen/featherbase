// #1379: Tickets reads like a shared inbox (Front's layout): each list line says who raised the
// ticket and how long ago it moved, the list column carries its own header, and the keyboard moves
// through the list. Tickets' own page in jsdom against the in-process server.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe } from 'vitest'
import { pinning, Tickets } from 'server/test/tickets-world'
import { ago, initials } from '../../../example-apps/tickets/src/inbox'
import { test as base, expect } from './pg-test'
import { openTickets } from './tickets-page'

const test = base.extend(pinning)
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}

const list = () => screen.getByLabelText('Tickets')
const lines = () => within(list()).getAllByRole('button')
const chosen = () => lines().find((line) => line.getAttribute('aria-pressed') === 'true')
const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key })

async function twoTickets(t: Tickets) {
  await t.complaint('Invoices cleared two days ago are missing from the report')
  await t.complaint('Stock report shows yesterday twice')
}

describe('a list line reads like an inbox line (#1379)', () => {
  test('the requester and how long ago lead; the summary; then ID · type · assignee and the state', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await openTickets(t.people.Support!)
    const line = await waitFor(() => lines().find((b) => b.textContent?.includes('Invoices cleared'))!)
    expect(line.querySelector('.ticket-requester')?.textContent).toBe('Anjali')
    expect(line.querySelector('.ticket-when')?.textContent).toBe('now')
    expect(line.querySelector('.avatar')?.textContent).toBe('A')
    expect(line.querySelector('.ticket-meta')?.textContent).toMatch(/^FT-\d+ · Stale \/ missing data · Unassigned$/)
    expect(line.querySelector('.ticket-foot .pill')).not.toBeNull()
  })

  test('the view, search, state filter and New ticket sit in the list column, above the list', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.complaint()
    await openTickets(t.people.Support!)
    const pane = list().closest('.list-pane')!
    expect(pane).not.toBeNull()
    for (const control of [screen.getByRole('searchbox', { name: 'Search tickets' }), screen.getByRole('combobox', { name: 'Filter by state' }), screen.getByRole('button', { name: '+ New ticket' })])
      expect(pane.contains(control)).toBe(true)
    expect(document.querySelector('.detail')!.contains(screen.getByRole('searchbox', { name: 'Search tickets' }))).toBe(false)
  })

  test('how long ago reads in minutes, hours and days, then as a date; initials take two words', () => {
    const now = Date.parse('2026-11-20T12:00:00Z')
    expect(ago('2026-11-20T11:59:40Z', now)).toBe('now')
    expect(ago('2026-11-20T11:55:00Z', now)).toBe('5m')
    expect(ago('2026-11-20T08:00:00Z', now)).toBe('4h')
    expect(ago('2026-11-17T12:00:00Z', now)).toBe('3d')
    expect(ago('2026-11-01T12:00:00Z', now)).toMatch(/^\d{2}-Nov$/)
    expect(initials('Bala Murugan Raj')).toBe('BM')
    expect(initials('—')).toBe('?')
  })
})

describe('the keyboard moves through the list (#1379)', () => {
  test('j and k open the next and previous ticket, stopping at the ends', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await twoTickets(t)
    await openTickets(t.people.Support!)
    await waitFor(() => expect(lines()).toHaveLength(2))
    await waitFor(() => expect(chosen()).toBe(lines()[0]))
    press('j')
    await waitFor(() => expect(chosen()).toBe(lines()[1]))
    press('j')
    expect(chosen()).toBe(lines()[1])
    press('k')
    await waitFor(() => expect(chosen()).toBe(lines()[0]))
  })

  test('/ focuses search and c opens New ticket; neither fires, nor does j, while typing in a field', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await twoTickets(t)
    await openTickets(t.people.Support!)
    await waitFor(() => expect(chosen()).toBe(lines()[0]))
    const search = screen.getByRole('searchbox', { name: 'Search tickets' })
    press('/')
    expect(document.activeElement).toBe(search)
    press('j', search)
    press('c', search)
    expect(chosen()).toBe(lines()[0])
    expect(document.querySelector('dialog[open]')).toBeNull()
    search.blur()
    press('c')
    await waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull())
  })
})
