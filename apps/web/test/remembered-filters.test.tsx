// #1228: a Table's list remembers the person's last filters beside its sort and
// columns (UI-013), in their server-side settings. A bare open brings them back;
// an address that names filters shows exactly those; Clear filters takes them
// all off, and the list then opens unfiltered.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableHref } from 'shared'

/** The router under the fixture, as TanStack's own: it navigates by address and keeps a history. */
type Router = { navigate: (to: { href: string }) => Promise<void>; history: { back: () => void } }
import { test, expect, renderApp } from './pg-test'
import { sql } from 'server/src/db'
import { invalidateMeta } from 'server/src/meta'

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

// Codex review, round 1: the list stays mounted when the same Table is opened
// again, so every arrival at a bare open must ask afresh.
test('a bare open of the same Table, without leaving the list, brings back the remembered filters', async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DEPT)}`, { filters: [KIDS] })
  const { router: fixtureRouter } = await renderApp(withFilters([['store', '=', 'Lakeside']]), admin)
  const router = fixtureRouter as unknown as Router
  await waitFor(() => expect(chips()).toHaveLength(1), T)
  expect(chipWords()[0]).toContain('Lakeside')

  await act(async () => { await router.navigate({ href: tableHref(DEPT) }) })
  await waitFor(() => expect(chipWords()).toEqual([expect.stringContaining('Kids')]), T)

  // A change made now, then another bare open: the newer filters, not the earlier visit's.
  await userEvent.click(screen.getByTestId('filter-clear-all'))
  await waitFor(() => expect(chips()).toHaveLength(0), T)
  await act(async () => { await router.navigate({ href: withFilters([ATK]) }) })
  await waitFor(() => expect(chips()).toHaveLength(1), T)
  await act(async () => { await router.navigate({ href: tableHref(DEPT) }) })
  await waitFor(() => expect(chips()).toHaveLength(0), T)
  expect(await rows()).toHaveLength(3)
})

// Codex review, round 2: Back to a bare entry must show it as it was, not
// restore over it filters chosen since.
test('Back to the unfiltered list it opened as shows it unfiltered, after a filter was added', async ({ admin }) => {
  await seed(admin)
  const { router: fixtureRouter } = await renderApp(tableHref(DEPT), admin)
  const router = fixtureRouter as unknown as Router
  expect(await rows()).toHaveLength(3)
  // A filter added since, and remembered.
  await admin.put(`/api/user_settings/${encodeURIComponent(DEPT)}`, { filters: [ATK] })
  await act(async () => { await router.navigate({ href: withFilters([ATK]) }) })
  await waitFor(() => expect(chips()).toHaveLength(1), T)

  await act(async () => { router.history.back() })
  await waitFor(() => expect(chips()).toHaveLength(0), T)
  await new Promise((r) => setTimeout(r, 300))
  expect(chips()).toHaveLength(0)
  expect(await rows()).toHaveLength(3)
}, 45_000)

// Merge train's note on #1228: settling the address must keep the path as it was
// opened, the remembered filters included. Two legacy Tables of one spelling share
// a slug, which names neither; opened by its exact name, the list must stay.
test('remembered filters come back on a Table opened by its exact name, whose slug is ambiguous', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Legacy Rf Probe', id_pattern: 'prompt', title_column: 'place',
    columns: [{ column_name: 'place', column_type: 'Data', label: 'Place', in_list_view: true }] })
  await admin.post('/api/save_row', { table: 'Legacy Rf Probe', row: { row_id: 'P1', place: 'Lakeside' } })
  await admin.post('/api/save_row', { table: 'Legacy Rf Probe', row: { row_id: 'P2', place: 'Hillview' } })
  // Hyphenated plain names are not legal for new Tables: a pre-existing legacy definition.
  await sql`insert into table_def (name, module, custom) values ('Legacy-Rf-Probe', 'Route acceptance', true)`
  invalidateMeta()
  await admin.put(`/api/user_settings/${encodeURIComponent('Legacy Rf Probe')}`, { filters: [['place', '=', 'Lakeside']] })
  await renderApp('/featherbase/admin/table/Legacy%20Rf%20Probe', admin)
  await waitFor(() => expect(chips()).toHaveLength(1), T)
  expect(chipWords()[0]).toContain('Lakeside')
  expect(screen.queryByText(/ambiguous/i)).toBeNull()
  await waitFor(() => expect(screen.getAllByRole('row').slice(1)).toHaveLength(1), T)
})
