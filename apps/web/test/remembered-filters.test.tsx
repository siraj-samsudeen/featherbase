// #1228: a Table's list remembers the person's last filters beside its sort and
// columns (UI-013), in their server-side settings. A bare open brings them back;
// an address that names filters shows exactly those; Clear filters takes them
// all off, and the list then opens unfiltered.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DEPT = 'Rf Department'
const T = { timeout: 10_000 }
const withFilters = (filters: unknown[]) => `${tableHref(DEPT)}?filters=${encodeURIComponent(JSON.stringify(filters))}`
const ATK = ['store', '=', 'Attakulangara']
const KIDS = ['dept_name', 'like', '%Kids%']

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DEPT, id_pattern: 'prompt', title_column: 'dept_name',
    columns: [
      { column_name: 'dept_name', column_type: 'Data', label: 'Department', in_list_view: true },
      { column_name: 'store', column_type: 'Data', label: 'Store', in_list_view: true },
    ],
  })
  for (const [row_id, dept_name, store] of [
    ['D1', 'Kids Wear', 'Attakulangara'], ['D2', 'Sarees', 'Attakulangara'], ['D3', 'Kids Wear', 'Lakeside'],
  ]) await admin.post('/api/save_row', { table: DEPT, row: { row_id, dept_name, store } })
}

const chips = () => screen.queryAllByTestId('filter-chip')
/** The filters the chips say are on, in their words. */
const chipWords = () => chips().map((chip) => chip.textContent ?? '')
/** The list's rows, by their Store and Department. */
async function rows() {
  await screen.findByTestId('list-table', {}, T).catch(() => undefined)
  await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1), T)
  return screen.getAllByRole('row').slice(1).map((row) => within(row).queryAllByRole('cell').map((c) => c.textContent).join('|'))
}

test('a filter changed on the list comes back on the next bare open, in the address', async ({ admin }) => {
  await seed(admin)
  await renderApp(withFilters([ATK, KIDS]), admin)
  await waitFor(() => expect(chips()).toHaveLength(2), T)
  // Taking the Kids filter off leaves Store = Attakulangara: that is remembered.
  await userEvent.click(within(chips()[1]!).getByRole('button', { name: 'Remove filter' }))
  await waitFor(() => expect(chips()).toHaveLength(1), T)

  cleanup()
  await renderApp(tableHref(DEPT), admin)
  await waitFor(() => expect(chips()).toHaveLength(1), T)
  expect(chipWords()[0]).toContain('Attakulangara')
  const shown = await rows()
  expect(shown.some((r) => r.includes('Lakeside'))).toBe(false)
  expect(shown.filter((r) => r.includes('Attakulangara'))).toHaveLength(2)
})

test('an address that names its own filters shows exactly those and leaves the remembered ones alone', async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DEPT)}`, { filters: [ATK] })
  await renderApp(withFilters([['store', '=', 'Lakeside']]), admin)
  await waitFor(() => expect(chips()).toHaveLength(1), T)
  expect(chipWords()[0]).toContain('Lakeside')

  cleanup()
  await renderApp(tableHref(DEPT), admin)
  await waitFor(() => expect(chips()).toHaveLength(1), T)
  expect(chipWords()[0]).toContain('Attakulangara')
})

test('Clear filters takes every filter off, and the list then opens unfiltered', async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DEPT)}`, { filters: [ATK, KIDS] })
  await renderApp(tableHref(DEPT), admin)
  await waitFor(() => expect(chips()).toHaveLength(2), T)
  await userEvent.click(screen.getByTestId('filter-clear-all'))
  await waitFor(() => expect(chips()).toHaveLength(0), T)
  expect(screen.queryByTestId('filter-clear-all')).not.toBeInTheDocument()

  cleanup()
  await renderApp(tableHref(DEPT), admin)
  expect(await rows()).toHaveLength(3)
  expect(chips()).toHaveLength(0)
})

test("the remembered filters keep the list's sort and columns, and the other way round", async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DEPT)}`, { sort: { field: 'dept_name', dir: 'desc' } })
  await renderApp(withFilters([ATK, KIDS]), admin)
  await waitFor(() => expect(chips()).toHaveLength(2), T)
  await userEvent.click(within(chips()[1]!).getByRole('button', { name: 'Remove filter' }))
  await waitFor(async () => {
    const { settings } = await admin.get<{ settings: Record<string, unknown> }>(`/api/user_settings/${encodeURIComponent(DEPT)}`)
    expect(settings).toMatchObject({ sort: { field: 'dept_name', dir: 'desc' }, filters: [ATK] })
  }, T)
})

test('a remembered value that is not a list of filters opens the list unfiltered', async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DEPT)}`, { filters: 'not a list' })
  await renderApp(tableHref(DEPT), admin)
  expect(await rows()).toHaveLength(3)
  expect(chips()).toHaveLength(0)
})
