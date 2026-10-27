// List View (openspec/specs/list-view): the one list every Table gets. Real
// ListView in jsdom against the in-process server, inside a rolled-back
// Postgres transaction.
//
// ListView writes the user's sort back with a fire-and-forget PUT, so every
// test that sorts waits for it to land (see list-settings.test.tsx) — a PUT
// that arrives after the sandbox closes would commit for real.

import { screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { afterAll, beforeAll, beforeEach, describe } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { invalidateSources } from 'server/src/sources/registry'
import { test, expect, renderApp } from './pg-test'

// A cold first render on a busy machine can take longer than the 1s default.

type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent
const rowsEl = () => screen.getByTestId('list-rows')
const cellTexts = (col: string) =>
  [...rowsEl().querySelectorAll(`[data-testid="cell-${col}"]`)].map((e) => e.textContent ?? '')

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

async function openList(admin: Admin, name: string, search = '') {
  await renderApp(`/featherbase/admin/${enc(name)}${search}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
  await screen.findByTestId('list-rows')
}

async function sortSettled(admin: Admin, name: string, want: { field: string; dir: string }) {
  await waitFor(async () => {
    const stored = await admin.get<{ settings: { sort: unknown } | null }>(`/api/user_settings/${enc(name)}`)
    expect(stored.settings?.sort).toEqual(want)
  })
}

test('Browse a table\'s rows: the list pages through the rows and the total keeps counting the whole table', async ({ admin }) => {
  await seedTickets(admin, 'Lv Paged', 25)
  await openList(admin, 'Lv Paged')
  await waitFor(() => expect(cellTexts('title')).toHaveLength(20))
  expect(screen.getByTestId('list-total')).toHaveTextContent('25 total')

  fireEvent.click(screen.getByTestId('next-page'))
  await waitFor(() => expect(cellTexts('title')).toHaveLength(5))
  expect(screen.getByTestId('list-total')).toHaveTextContent('25 total')
  expect(screen.getByTestId('next-page')).toBeDisabled()

  fireEvent.click(screen.getByTestId('prev-page'))
  await waitFor(() => expect(cellTexts('title')).toHaveLength(20))
})

test('Browse a table\'s rows: opening a row takes the user to its full form', async ({ admin }) => {
  await seedTickets(admin, 'Lv Open', 2)
  await openList(admin, 'Lv Open')
  await waitFor(() => expect(cellTexts('title')).toHaveLength(2))
  const target = within(rowsEl()).getByText('row-01').closest('tr') as HTMLElement
  fireEvent.click(within(target).getByRole('link'))
  expect(await screen.findByTestId('form-view')).toBeInTheDocument()
  await waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('[data-field=title]')).toHaveValue('row-01'),
  )
})

test('Sort by any column: clicking a heading sorts, clicking it again reverses the order', async ({ admin }) => {
  await seedTickets(admin, 'Lv Sorted', 3)
  await openList(admin, 'Lv Sorted')
  await waitFor(() => expect(cellTexts('title')).toHaveLength(3))

  fireEvent.click(screen.getByTestId('col-rank'))
  await waitFor(() => expect(cellTexts('title')).toEqual(['row-01', 'row-02', 'row-03']))
  await sortSettled(admin, 'Lv Sorted', { field: 'rank', dir: 'asc' })

  fireEvent.click(screen.getByTestId('col-rank'))
  await waitFor(() => expect(cellTexts('title')).toEqual(['row-03', 'row-02', 'row-01']))
  await sortSettled(admin, 'Lv Sorted', { field: 'rank', dir: 'desc' })
})

test('Narrow the list with filters: a filter narrows the rows, shows as its own chip, and removing it brings every row back', async ({ admin }) => {
  await seedTickets(admin, 'Lv Filtered', 4)
  await openList(admin, 'Lv Filtered')
  await waitFor(() => expect(cellTexts('title')).toHaveLength(4))

  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'stage' } })
  fireEvent.change(screen.getByTestId('filter-value'), { target: { value: 'Open' } })
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(cellTexts('title')).toEqual(['row-03', 'row-01']))
  expect(screen.getAllByTestId('filter-chip')).toHaveLength(1)

  // A second filter narrows further, and each chip can go on its own.
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'rank' } })
  fireEvent.change(screen.getByTestId('filter-op'), { target: { value: '>' } })
  fireEvent.change(screen.getByTestId('filter-value'), { target: { value: '1' } })
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(cellTexts('title')).toEqual(['row-03']))
  expect(screen.getAllByTestId('filter-chip')).toHaveLength(2)

  fireEvent.click(within(screen.getAllByTestId('filter-chip')[1]).getByLabelText('Remove filter'))
  await waitFor(() => expect(cellTexts('title')).toEqual(['row-03', 'row-01']))
  fireEvent.click(within(screen.getAllByTestId('filter-chip')[0]).getByLabelText('Remove filter'))
  await waitFor(() => expect(cellTexts('title')).toHaveLength(4))
  expect(screen.queryByTestId('filter-chip')).not.toBeInTheDocument()
})

test('Narrow the list with filters: a quick filter box above the list filters its column', async ({ admin }) => {
  await seedTickets(admin, 'Lv Quick', 4)
  await openList(admin, 'Lv Quick')
  await waitFor(() => expect(cellTexts('title')).toHaveLength(4))

  fireEvent.change(await screen.findByTestId('std-filter-stage'), { target: { value: 'Closed' } })
  await waitFor(() => expect(cellTexts('title')).toEqual(['row-04', 'row-02']))
  fireEvent.change(screen.getByTestId('std-filter-stage'), { target: { value: '' } })
  await waitFor(() => expect(cellTexts('title')).toHaveLength(4))
})

test('Filters live in the page address: opening an address that carries filters shows the narrowed list', async ({ admin }) => {
  await seedTickets(admin, 'Lv Address', 4)
  const filters = JSON.stringify([['stage', '=', 'Closed']])
  await openList(admin, 'Lv Address', `?filters=${enc(filters)}`)
  await waitFor(() => expect(cellTexts('title')).toEqual(['row-04', 'row-02']))
  expect(screen.getAllByTestId('filter-chip')).toHaveLength(1)
  expect(screen.getByTestId('list-total')).toHaveTextContent('2 total')
})

test('Act on many rows at once: setting a field on selected rows changes all of them', async ({ admin }) => {
  await seedTickets(admin, 'Lv Bulk', 5)
  await openList(admin, 'Lv Bulk')
  await waitFor(() => expect(cellTexts('title')).toHaveLength(5))

  fireEvent.click(screen.getByTestId('select-all'))
  await waitFor(() => expect(screen.getByTestId('bulk-count')).toHaveTextContent('5 selected'))
  fireEvent.change(screen.getByTestId('bulk-edit-field'), { target: { value: 'stage' } })
  fireEvent.change(await screen.findByTestId('bulk-edit-value'), { target: { value: 'Closed' } })
  fireEvent.click(screen.getByTestId('bulk-edit-apply'))

  await waitFor(() => expect(cellTexts('stage').every((t) => t.includes('Closed'))).toBe(true))
  expect(cellTexts('stage')).toHaveLength(5)
  const after = await admin.get<{ data: { row_id: string }[] }>(`/api/table/${enc('Lv Bulk')}`)
  for (const r of after.data) {
    const one = await admin.get<{ stage: string }>(`/api/table/${enc('Lv Bulk')}/${r.row_id}`)
    expect(one.stage).toBe('Closed')
  }
  expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument()
})

test('Act on many rows at once: selected rows can be deleted together', async ({ admin }) => {
  await seedTickets(admin, 'Lv Bulk Del', 4)
  await openList(admin, 'Lv Bulk Del')
  await waitFor(() => expect(cellTexts('title')).toHaveLength(4))

  const checks = within(rowsEl()).getAllByTestId('row-check')
  fireEvent.click(checks[0])
  fireEvent.click(checks[1])
  await waitFor(() => expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 selected'))
  fireEvent.click(screen.getByTestId('bulk-delete'))
  // #327: it asks first, naming how many rows will go.
  const dialog = screen.getByRole('dialog', { name: 'Delete 2 rows?' })
  expect(dialog).toHaveTextContent('The selected rows will be permanently deleted. This cannot be undone.')
  expect(screen.getByTestId('bulk-delete-cancel')).toHaveFocus()
  fireEvent.click(screen.getByTestId('bulk-delete-confirm'))

  await waitFor(() => expect(cellTexts('title')).toHaveLength(2))
  expect(screen.getByTestId('list-total')).toHaveTextContent('2 total')
  expect(screen.queryByTestId('bulk-delete-dialog')).not.toBeInTheDocument()
})

test('Act on many rows at once: backing out of the delete confirmation deletes nothing (#327)', async ({ admin }) => {
  await seedTickets(admin, 'Lv Bulk Keep', 3)
  await openList(admin, 'Lv Bulk Keep')
  await waitFor(() => expect(cellTexts('title')).toHaveLength(3))
  fireEvent.click(within(rowsEl()).getAllByTestId('row-check')[0])

  fireEvent.click(await screen.findByTestId('bulk-delete'))
  expect(screen.getByRole('dialog', { name: 'Delete 1 row?' })).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('bulk-delete-cancel'))
  expect(screen.queryByTestId('bulk-delete-dialog')).not.toBeInTheDocument()

  fireEvent.click(screen.getByTestId('bulk-delete'))
  fireEvent.keyDown(screen.getByTestId('bulk-delete-dialog'), { key: 'Escape' })
  expect(screen.queryByTestId('bulk-delete-dialog')).not.toBeInTheDocument()

  fireEvent.click(screen.getByTestId('bulk-delete'))
  fireEvent.click(screen.getByTestId('bulk-delete-dialog').parentElement!)
  expect(screen.queryByTestId('bulk-delete-dialog')).not.toBeInTheDocument()

  expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 selected')
  expect((await admin.get<{ data: unknown[] }>(`/api/table/${enc('Lv Bulk Keep')}`)).data).toHaveLength(3)
})

test('See a row\'s nested rows without opening it: expanding shows its lines in place and collapsing hides them', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Lv Order Line',
    kind: 'sub_table',
    columns: [{ column_name: 'item', column_type: 'Data', label: 'Item' }],
  })
  await admin.post('/api/table_def', {
    name: 'Lv Order',
    columns: [
      { column_name: 'customer', column_type: 'Data', label: 'Customer', in_list_view: true },
      { column_name: 'lines', column_type: 'Sub-table', label: 'Lines', row_table: 'Lv Order Line' },
    ],
  })
  await admin.post('/api/save_row', {
    table: 'Lv Order',
    row: { customer: 'Acme', lines: [{ item: 'bolt' }, { item: 'washer' }] },
  })
  await openList(admin, 'Lv Order')
  await waitFor(() => expect(cellTexts('customer')).toEqual(['Acme']))

  fireEvent.click(screen.getByTestId('row-expand'))
  const grid = await screen.findByTestId('inline-children-lines')
  expect(await within(grid).findByText('bolt')).toBeInTheDocument()
  expect(within(grid).getByText('washer')).toBeInTheDocument()

  fireEvent.click(screen.getByTestId('row-expand'))
  await waitFor(() => expect(screen.queryByTestId('expanded-row')).not.toBeInTheDocument())
  expect(screen.queryByText('bolt')).not.toBeInTheDocument()
})

test('An empty list says so and, for someone who may add rows, offers the first one', async ({ admin }) => {
  await seedTickets(admin, 'Lv Empty', 0)
  await openList(admin, 'Lv Empty')
  expect(await screen.findByText(/No rows/)).toBeInTheDocument()
  expect(screen.getByTestId('list-empty-new')).toBeInTheDocument()
})

test('A list that cannot load says why instead of reading as empty', async ({ admin }) => {
  await seedTickets(admin, 'Lv Broken', 2)
  // A filter on a column the table does not have is refused by the server.
  const filters = JSON.stringify([['no_such_column', '=', 'x']])
  await openList(admin, 'Lv Broken', `?filters=${enc(filters)}`)
  const failure = await screen.findByTestId('list-rows-error')
  expect(failure.textContent).toMatch(/\S/)
  expect(failure.textContent).not.toMatch(/^No rows/)
})

test('Dates and numbers read the same way everywhere: dates as day-month-year, amounts and counts grouped the Indian way', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Lv Formats',
    columns: [
      { column_name: 'label', column_type: 'Data', label: 'Label', in_list_view: true },
      { column_name: 'due', column_type: 'Date', label: 'Due', in_list_view: true },
      { column_name: 'amount', column_type: 'Currency', label: 'Amount', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', {
    table: 'Lv Formats',
    row: { label: 'big one', due: '2026-01-15', amount: 1234567.5 },
  })
  await openList(admin, 'Lv Formats')
  await waitFor(() => expect(cellTexts('due')).toEqual(['15-Jan-2026']))
  expect(cellTexts('amount')[0]).toContain('12,34,567.50')
})

test('Nothing shown by colour alone: a status in the list is written in words beside its coloured dot', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Lv Status',
    columns: [
      { column_name: 'label', column_type: 'Data', label: 'Label', in_list_view: true },
      { column_name: 'state', column_type: 'Choice', label: 'State', choices: 'Open\nBlocked', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: 'Lv Status', row: { label: 'a', state: 'Blocked' } })
  await openList(admin, 'Lv Status')
  await waitFor(() => expect(cellTexts('state')).toEqual(['Blocked']))
  const dot = rowsEl().querySelector('[data-testid="cell-state"] [aria-hidden="true"]')
  expect(dot).not.toBeNull()
  expect(dot?.textContent).toBe('')
})

// ── A read-only source ─────────────────────────────────────────────────────

describe('A read-only source', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'fb-listview-'))
  })
  beforeEach(() => {
    writeFileSync(path.join(dir, 'store_master.csv'), 'store_code,store_name\nKKL,Karaikal\nTVM,Trivandrum\n')
  })
  afterAll(() => {
    invalidateSources()
    rmSync(dir, { recursive: true, force: true })
  })

  test('A read-only connected table can be browsed but not changed here: sortable and filterable, with no selection and no way to add', async ({ admin }) => {
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      row_id: 'list-view-readonly',
      engine: 'csv-folder',
      root_path: dir,
      access: 'read_only',
    })
    const res = await admin.fetch('/api/table/Data%20Source/list-view-readonly:reflect', {
      method: 'POST',
      body: JSON.stringify({ tables: ['store_master.csv'] }),
    })
    const created = ((await res.json()) as { created: { name: string }[] }).created[0].name

    await renderApp(`/featherbase/admin/${enc(created)}`, admin)
    await screen.findByTestId('list-view', {}, { timeout: 8000 })
    await waitFor(() => expect(within(rowsEl()).getByText('Karaikal')).toBeInTheDocument())
    expect(screen.getByTestId('source-badge')).toHaveTextContent('read-only')

    // Absent, not disabled.
    expect(screen.queryByTestId('select-all')).not.toBeInTheDocument()
    expect(screen.queryByTestId('row-check')).not.toBeInTheDocument()
    expect(screen.queryByTestId('list-new')).not.toBeInTheDocument()

    // Still sortable.
    fireEvent.click(screen.getByTestId('col-store_name'))
    await waitFor(() => expect(rowsEl().querySelector('tr')?.textContent).toContain('Karaikal'))
    fireEvent.click(screen.getByTestId('col-store_name'))
    await waitFor(() => expect(rowsEl().querySelector('tr')?.textContent).toContain('Trivandrum'))
    await waitFor(async () => {
      const stored = await admin.get<{ settings: { sort: { dir: string } | null } | null }>(
        `/api/user_settings/${enc(created)}`,
      )
      expect(stored.settings?.sort?.dir).toBe('desc')
    })
  })
})
