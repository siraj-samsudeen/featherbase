// #1242 (admin-lists 1-3): a Table's list has one primary action, New <thing>,
// last on the title's line after a ⋯ More menu; its other views are
// in the toolbar's View menu; Search filters on the title column as a chip; and
// Show retired is a toggle chip in the toolbar.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableHref } from 'shared'
import { sql } from 'server/src/db'
import { invalidateMeta } from 'server/src/meta'
import { test, expect, renderApp } from './pg-test'
import { openListMenu } from './list-menus'

type Admin = Parameters<typeof renderApp>[1]
const DEPT = 'alh department raw'
const T = { timeout: 10_000 }

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: DEPT, module: 'Store Layout', id_pattern: 'prompt', title_column: 'dept_name',
    columns: [{ column_name: 'dept_name', column_type: 'Data', label: 'Department', in_list_view: true }] })
  await sql`update table_def set label = 'Job Assignment' where name = ${DEPT}`
  invalidateMeta()
  for (const [row_id, dept_name] of [['D1', 'Kids Wear'], ['D2', 'Sarees'], ['D3', 'Bags & Silk']])
    await admin.post('/api/save_row', { table: DEPT, row: { row_id, dept_name } })
}

const rows = () => screen.getAllByRole('row').slice(1)

// #1288: the one primary (New <thing>) comes before More, which is last (the UI owner's PageHeader rule, 18-Nov-2026).
test('the title line: <Module> / <label>, the label and its total, then New <thing>, then More last', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(DEPT), admin)
  expect(await screen.findByTestId('list-breadcrumb', {}, T)).toHaveTextContent(/^Store Layout \/ Job Assignment$/)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Job Assignment')
  const header = screen.getByTestId('list-toolbar')
  const controls = [...header.querySelectorAll('a, button')].map((el) => el.textContent?.trim())
  expect(controls.indexOf('New job assignment')).toBeGreaterThanOrEqual(0)
  expect(controls.indexOf('New job assignment')).toBeLessThan(controls.indexOf('More'))
  // The other views are not on the title's line.
  expect(within(header).queryByRole('button', { name: /^View/ })).toBeNull()
  const view = await openListMenu('View')
  expect(view.getByTestId('open-report')).toBeInTheDocument()
  // #1276: Explore is retired; a list follows links with Linked to… instead.
  expect(view.queryByTestId('open-explore')).not.toBeInTheDocument()
})

test('Search finds rows by their title, as a remembered filter chip; an empty search takes it off', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(DEPT), admin)
  await waitFor(() => expect(rows()).toHaveLength(3), T)
  const search = screen.getByRole('searchbox', { name: 'Search Job Assignment' })
  await userEvent.type(search, 'silk{Enter}')
  await waitFor(() => expect(rows()).toHaveLength(1), T)
  expect(rows()[0]).toHaveTextContent('Bags & Silk')
  expect(screen.getAllByTestId('filter-chip')).toHaveLength(1)
  await waitFor(async () => expect((await admin.get<{ settings: { filters?: unknown } }>(`/api/user_settings/${encodeURIComponent(DEPT)}`)).settings.filters)
    .toEqual([['dept_name', 'like', '%silk%']]), T)

  await userEvent.clear(search)
  await userEvent.type(search, '{Enter}')
  await waitFor(() => expect(rows()).toHaveLength(3), T)
  expect(screen.queryAllByTestId('filter-chip')).toHaveLength(0)
})

test('Show retired is a toggle chip in the toolbar', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/retire_row', { table: DEPT, name: 'D2', reason: 'Merged into Silk' }).catch(() => undefined)
  await renderApp(tableHref(DEPT), admin)
  const chip = await screen.findByRole('checkbox', { name: 'Show retired' }, T)
  expect(chip).not.toBeChecked()
  // In the toolbar, not on the title's line.
  expect(within(screen.getByTestId('list-toolbar')).queryByTestId('list-show-retired-toggle')).toBeNull()
  await userEvent.click(chip)
  expect(chip).toBeChecked()
})

// #1242 (admin-lists 6, 9).
test('one page of rows reads "1–3 of 3" with no Prev or Next', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(DEPT), admin)
  await waitFor(() => expect(rows()).toHaveLength(3), T)
  expect(screen.getByTestId('page-info')).toHaveTextContent('1–3 of 3')
  expect(screen.queryByTestId('prev-page')).toBeNull()
  expect(screen.queryByTestId('next-page')).toBeNull()
})

test('an empty Table shows the way forward: New and Import data', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'alh empty raw', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] })
  await renderApp(tableHref('alh empty raw'), admin)
  expect(await screen.findByRole('heading', { level: 3, name: 'No rows' }, T)).toBeInTheDocument()
  expect(screen.getByTestId('list-empty-new')).toHaveTextContent(/^New alh empty raw$/)
  expect(screen.getByTestId('list-empty-import')).toHaveTextContent('Import data')
})
// A linked cell's code, muted inside the link: drill-pane.test.tsx ("Kerala · KL").

// Codex review, round 9: the box follows the search the list has, so Enter never
// brings back words that were taken off elsewhere.
// #1289: with one filter on, its chip's ✕ takes it off (Clear All Filters shows only with more than one).
test("taking the search's chip off empties the search box as well", async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(DEPT), admin)
  await waitFor(() => expect(rows()).toHaveLength(3), T)
  const search = screen.getByRole('searchbox', { name: 'Search Job Assignment' })
  await userEvent.type(search, 'silk{Enter}')
  await waitFor(() => expect(rows()).toHaveLength(1), T)
  expect(screen.queryByTestId('filter-clear-all')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^Remove .+ filter$/ }))
  await waitFor(() => expect(rows()).toHaveLength(3), T)
  expect(search).toHaveValue('')
  await userEvent.type(search, '{Enter}')
  await waitFor(() => expect(rows()).toHaveLength(3), T)
  expect(screen.queryAllByTestId('filter-chip')).toHaveLength(0)
})

// #1224's verifier: the tab reads "<page> · <app>", never the app alone on a page that has a name.
test("a list's tab reads its Table, then the app; a row's page likewise", async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(DEPT), admin)
  await waitFor(() => expect(document.title).toBe('Job Assignment · Featherbase'), T)
  await renderApp(`${tableHref(DEPT)}/row/D1`, admin)
  await waitFor(() => expect(document.title).toBe('Job Assignment · Featherbase'), T)
})
