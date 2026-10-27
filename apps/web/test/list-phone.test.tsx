// usable-on-any-device "Lists fit a phone" (#380 task 4.1): below 40rem the
// one ListView reads as a card per row, and what the wide table offers —
// selection and bulk actions, sorting, nested rows, paging, the empty and
// failed states — still works on the cards. Real ListView in jsdom against
// the in-process server, inside a rolled-back Postgres transaction.

import { screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent

// Only the list's own breakpoint answers "narrow"; the Admin shell's own
// phone queries stay wide, so this checks the list and nothing else.
const LIST_NARROW = '(width < 40rem)'
const real = window.matchMedia
beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === LIST_NARROW,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  window.matchMedia = real
})

async function seedTickets(admin: Admin, name: string, count = 3) {
  await admin.post('/api/table_def', {
    name,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', label: 'Stage', choices: 'Open\nClosed', in_list_view: true },
      { column_name: 'rank', column_type: 'Int', label: 'Rank', in_list_view: true },
    ],
  })
  for (let i = 1; i <= count; i++)
    await admin.post('/api/save_row', {
      table: name,
      row: { title: `row-${String(i).padStart(2, '0')}`, stage: i % 2 ? 'Open' : 'Closed', rank: i },
    })
}

async function openList(admin: Admin, name: string) {
  await renderApp(`/featherbase/admin/${enc(name)}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
}

const cards = () => within(screen.getByRole('list', { name: /^Rows of / })).getAllByRole('listitem')
const titles = () => cards().map((c) => within(c).getByRole('link').textContent)

test('On a phone each row is a card: its title opens the row, its status is in words, its figures are labelled', async ({ admin }) => {
  await seedTickets(admin, 'Lp Cards', 2)
  await openList(admin, 'Lp Cards')
  await waitFor(() => expect(cards()).toHaveLength(2))
  expect(screen.queryByRole('table')).not.toBeInTheDocument()

  const first = cards().find((c) => within(c).queryByText('row-01'))!
  expect(within(first).getByRole('link', { name: 'row-01' })).toHaveAttribute(
    'href',
    expect.stringMatching(/^\/featherbase\/admin\/Lp%20Cards\/.+/),
  )
  expect(within(first).getByText('Open')).toBeInTheDocument()
  // A figure carries its column's label beside it, as the table's header would.
  const rank = within(first).getByText('Rank')
  expect(rank.tagName).toBe('DT')
  expect(rank.nextElementSibling).toHaveTextContent('1')
})

test('On a phone a card can be selected, all on the page at once, and the bulk bar counts them', async ({ admin }) => {
  await seedTickets(admin, 'Lp Select', 3)
  await openList(admin, 'Lp Select')
  await waitFor(() => expect(cards()).toHaveLength(3))

  fireEvent.click(within(cards()[0]).getByRole('checkbox', { name: /^Select / }))
  await waitFor(() => expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 selected'))

  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }))
  await waitFor(() => expect(screen.getByTestId('bulk-count')).toHaveTextContent('3 selected'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }))
  await waitFor(() => expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument())
})

test('On a phone the list sorts from a Sort by control, and the order is kept for next time', async ({ admin }) => {
  await seedTickets(admin, 'Lp Sort', 3)
  await openList(admin, 'Lp Sort')
  await waitFor(() => expect(cards()).toHaveLength(3))

  fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'rank' } })
  await waitFor(() => expect(titles()).toEqual(['row-01', 'row-02', 'row-03']))
  fireEvent.click(screen.getByRole('button', { name: 'Sort order: ascending' }))
  await waitFor(() => expect(titles()).toEqual(['row-03', 'row-02', 'row-01']))
  expect(screen.getByRole('button', { name: 'Sort order: descending' })).toBeInTheDocument()

  await waitFor(async () => {
    const stored = await admin.get<{ settings: { sort: unknown } | null }>(`/api/user_settings/${enc('Lp Sort')}`)
    expect(stored.settings?.sort).toEqual({ field: 'rank', dir: 'desc' })
  })
})

test('On a phone a card shows its nested rows in place and hides them again', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Lp Order Line',
    kind: 'sub_table',
    columns: [{ column_name: 'item', column_type: 'Data', label: 'Item' }],
  })
  await admin.post('/api/table_def', {
    name: 'Lp Order',
    columns: [
      { column_name: 'customer', column_type: 'Data', label: 'Customer', in_list_view: true },
      { column_name: 'lines', column_type: 'Sub-table', label: 'Lines', row_table: 'Lp Order Line' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Lp Order', row: { customer: 'Acme', lines: [{ item: 'bolt' }, { item: 'washer' }] } })
  await openList(admin, 'Lp Order')
  await waitFor(() => expect(cards()).toHaveLength(1))

  const toggle = within(cards()[0]).getByRole('button', { name: 'Show nested rows' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  const grid = await screen.findByTestId('inline-children-lines')
  expect(await within(grid).findByText('bolt')).toBeInTheDocument()
  expect(within(grid).getByText('washer')).toBeInTheDocument()

  fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Hide nested rows' }))
  await waitFor(() => expect(screen.queryByText('bolt')).not.toBeInTheDocument())
})

test('On a phone the cards page through the rows like the table', async ({ admin }) => {
  await seedTickets(admin, 'Lp Paged', 22)
  await openList(admin, 'Lp Paged')
  await waitFor(() => expect(cards()).toHaveLength(20))
  fireEvent.click(screen.getByTestId('next-page'))
  await waitFor(() => expect(cards()).toHaveLength(2))
  expect(screen.getByTestId('page-info')).toHaveTextContent('21–22 of 22')
})

test('On a phone an empty list says so and offers the first row', async ({ admin }) => {
  await seedTickets(admin, 'Lp Empty', 0)
  await openList(admin, 'Lp Empty')
  expect(await screen.findByText(/No rows/)).toBeInTheDocument()
  expect(screen.getByTestId('list-empty-new')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})
