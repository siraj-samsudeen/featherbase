// #101: the Admin remembers what the person visited — rows, filtered lists —
// and offers the trail back: in the empty search bar, in the sidebar, in the
// Recent strip above a Table's list, and on the server. Moved from the deleted
// e2e/recents.spec.ts. The trail is built by navigating the real router; every
// request is the real in-process server's.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { decodePath } from '../src/lib/nav-path'

const DT = 'Recents DT'
const DOC = 'quokka-recent-doc'
// The Table has no title column, so the row reads by its first readable value,
// never by the id above (#476).
const DOC_TITLE = 'searchable'
const LIST = `/featherbase/admin/table/${tableSlug(DT)}`
const ROW = `${LIST}/row/${DOC}`
const FILTERS = JSON.stringify([['note', '=', 'searchable']])
const WAIT = { timeout: 10_000 }

type Admin = Parameters<typeof renderApp>[1]
type App = Awaited<ReturnType<typeof renderApp>>
type Location = { pathname: string; searchStr: string }
const location = (app: App) => (app.router as unknown as { state: { location: Location } }).state.location

/** The filters the address carries, wherever the app put them. */
function filtersIn(app: App): unknown[] {
  const params = new URLSearchParams(location(app).searchStr)
  const path = decodePath(params.get('path') ?? undefined)
  let value: unknown = path ? path.steps[path.at]?.filters ?? [] : params.get('filters')
  while (typeof value === 'string') value = JSON.parse(value)
  return Array.isArray(value) ? value : []
}

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'note', column_type: 'Data', label: 'Note', in_list_view: true }],
  })
  await admin.post('/api/save_row', { table: DT, row: { row_id: DOC, note: 'searchable' } })
}

/** Visit the filtered list, then the row, and end on `end`. */
async function buildTrail(admin: Admin, end = '/featherbase/admin') {
  await seed(admin)
  const app = await renderApp(`${LIST}?filters=${encodeURIComponent(FILTERS)}`, admin)
  await screen.findByTestId('list-view', {}, WAIT)
  await app.router.navigate({ to: ROW })
  await screen.findByTestId('form-view', {}, WAIT)
  if (end !== ROW) await app.router.navigate({ to: end })
  return app
}

async function openEmptyBar() {
  const bar = screen.getByLabelText('Search or type a command')
  fireEvent.focus(bar)
  await waitFor(() => expect(screen.getAllByTestId('awesomebar-recent').length).toBeGreaterThanOrEqual(2), WAIT)
  return bar
}

test('#101: the empty search bar lists the trail newest first, each visit by its title', async ({ admin }) => {
  await buildTrail(admin)
  await openEmptyBar()
  const [row, list] = screen.getAllByTestId('awesomebar-recent')
  expect(row).toHaveTextContent(DOC_TITLE)
  expect(row).not.toHaveTextContent(DOC)
  expect(list).toHaveTextContent(DT)
  expect(list).toHaveTextContent('Note = searchable')
})

test('#101: a filtered list chosen from the empty search bar opens with its filters', async ({ admin }) => {
  const app = await buildTrail(admin)
  await openEmptyBar()
  fireEvent.click(screen.getAllByTestId('awesomebar-recent')[1])
  await screen.findByTestId('table-page', {}, WAIT)
  expect(location(app).pathname).toBe(LIST)
  expect(filtersIn(app)).toContainEqual(['note', '=', 'searchable'])
})

test('#101: in the empty search bar, an arrow key and Enter replay a recent row', async ({ admin }) => {
  const app = await buildTrail(admin)
  // Revisit the list, so the row is second in the trail.
  await app.router.navigate({ to: LIST, search: { filters: FILTERS } as never })
  await screen.findByTestId('list-view', {}, WAIT)
  await app.router.navigate({ to: '/featherbase/admin' })
  const bar = await openEmptyBar()
  await waitFor(() => expect(screen.getAllByTestId('awesomebar-recent')[0]).toHaveTextContent(DT))
  const row = screen.getAllByTestId('awesomebar-recent')[1]
  expect(row).toHaveTextContent(DOC_TITLE)
  for (let i = 0; i < 2 && row.getAttribute('aria-selected') !== 'true'; i++) fireEvent.keyDown(bar, { key: 'ArrowDown' })
  expect(row).toHaveAttribute('aria-selected', 'true')
  fireEvent.submit(bar.closest('form') as HTMLFormElement)
  await screen.findByTestId('form-view', {}, WAIT)
  expect(location(app).pathname).toBe(ROW)
})

test('#101 P2: the sidebar puts the row being looked at first, by its title', async ({ admin }) => {
  await buildTrail(admin, ROW)
  const sidebar = await screen.findByTestId('sidebar-recents', {}, WAIT)
  await waitFor(() => expect(within(sidebar).getAllByTestId('sidebar-recent')[0]).toHaveTextContent(DOC_TITLE), WAIT)
  expect(within(sidebar).getAllByTestId('sidebar-recent')[0]).not.toHaveTextContent(DOC)
})

test('#101 P2: the sidebar\'s filtered-list entry names its filter and opens the list with it', async ({ admin }) => {
  const app = await buildTrail(admin, ROW)
  const sidebar = await screen.findByTestId('sidebar-recents', {}, WAIT)
  const entry = await waitFor(() => {
    const found = within(sidebar).getAllByTestId('sidebar-recent').find((e) => e.textContent?.includes('Note = searchable'))
    expect(found).toBeDefined()
    return found!
  }, WAIT)
  fireEvent.click(entry)
  await screen.findByTestId('table-page', {}, WAIT)
  expect(location(app).pathname).toBe(LIST)
  expect(filtersIn(app)).toContainEqual(['note', '=', 'searchable'])
})

test('#101 P2: the Recent strip above the list offers its recent filter set, which re-applies the filters', async ({ admin }) => {
  const app = await buildTrail(admin, LIST)
  const strip = await screen.findByTestId('recent-strip', {}, WAIT)
  const view = await within(strip).findByTestId('recent-strip-view', {}, WAIT)
  expect(view).toHaveTextContent('Note = searchable')
  fireEvent.click(view)
  await waitFor(() => expect(filtersIn(app)).toContainEqual(['note', '=', 'searchable']))
})

test('#101 P2: the Recent strip above the list offers its recent row by title, which opens its form', async ({ admin }) => {
  const app = await buildTrail(admin, LIST)
  const strip = await screen.findByTestId('recent-strip', {}, WAIT)
  const row = await within(strip).findByTestId('recent-strip-row', {}, WAIT)
  await waitFor(() => expect(row).toHaveTextContent(DOC_TITLE))
  fireEvent.click(row)
  await screen.findByTestId('form-view', {}, WAIT)
  expect(location(app).pathname).toBe(ROW)
})

test('#101 P3: a row visit reaches the server\'s trail after the pause', async ({ admin }) => {
  await seed(admin)
  await renderApp(ROW, admin)
  await screen.findByTestId('form-view', {}, WAIT)
  await waitFor(async () => {
    const summary = await admin.get<{ entries: { key: string }[] }>('/api/events/summary')
    expect(summary.entries.map((e) => e.key)).toContain(`row:${DT}/${DOC}`)
  }, { timeout: 15_000, interval: 500 })
}, 30_000)
