// Home cleanup (26-Oct-2026): what Home and the sidebar's Recent show for a
// remembered page or row, the unlabelled link card, and the activity feed's
// one-sentence rows. Every claim is read off the rendered page.
import { screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { recordAction } from '../src/lib/recents'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
const MERCH = 'Home Merch Map'
const MERCH_ROW = '1517|040802006'
const SIDEBAR_WAIT = { timeout: 15_000 }

/** A Table with NO title column, whose row id is a composite code. */
async function seedMerch(admin: Client) {
  await admin.post('/api/table_def', {
    name: MERCH,
    id_pattern: 'prompt',
    columns: ['store_code', 'material_group', 'mch_subcategory', 'section_name'].map((column_name) => ({ column_name, column_type: 'Data' })),
  })
  await admin.post('/api/save_row', {
    table: MERCH,
    row: { row_id: MERCH_ROW, store_code: '1517', material_group: '040802006', mch_subcategory: 'Kurti Z', section_name: 'Kurti' },
  })
}

function rememberRow(user: string, at: number) {
  recordAction(user, {
    kind: 'row', key: `row:${MERCH}/${MERCH_ROW}`, label: MERCH_ROW, sub: MERCH,
    path: `/featherbase/admin/${encodeURIComponent(MERCH)}/${encodeURIComponent(MERCH_ROW)}`,
  }, at)
}

/** What the browser buffer held before #442: a fixed page as a slug-named list. */
function rememberOldExplore(user: string, at: number) {
  recordAction(user, { kind: 'list', key: 'list:explore?', label: 'explore', path: '/featherbase/admin/explore' }, at)
}

test('Last view shows an old slug-labelled page by its catalog title, on Home and in Recent', async ({ admin }) => {
  rememberOldExplore('Administrator', Date.now() - 1000)
  await renderApp('/featherbase/admin', admin)
  const tile = await screen.findByTestId('resume-tile-view')
  expect(within(tile).getByTestId('resume-tile-title')).toHaveTextContent('Explore')
  expect(tile).not.toHaveTextContent(/\bexplore\b/)
  const recent = await screen.findByTestId('sidebar-recent', {}, SIDEBAR_WAIT)
  expect(recent).toHaveTextContent('Explore')
  expect(recent).not.toHaveTextContent(/\bexplore\b/)
})

test('Last row reads as the row, with its Table beneath — not its internal id', async ({ admin }) => {
  await seedMerch(admin)
  rememberRow('Administrator', Date.now() - 1000)
  await renderApp('/featherbase/admin', admin)
  const tile = await screen.findByTestId('resume-tile-row')
  await waitFor(() => expect(within(tile).getByTestId('resume-tile-title')).toHaveTextContent('1517 · Kurti Z'))
  expect(within(tile).getByTestId('resume-tile-sub')).toHaveTextContent(MERCH)
  expect(tile).not.toHaveTextContent(MERCH_ROW)
  const recent = await screen.findByTestId('sidebar-recent', {}, SIDEBAR_WAIT)
  await waitFor(() => expect(recent).toHaveTextContent('1517 · Kurti Z'))
  expect(recent).not.toHaveTextContent(MERCH_ROW)
})

test("a home page's links curated before any card break sit under a heading", async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Home Suppliers', columns: [{ column_name: 'supplier_name', column_type: 'Data' }] })
  await renderApp('/featherbase/admin/home/home', admin)
  const card = (await screen.findByTestId('home-link-Home Suppliers')).closest('[data-testid^="home-card-"]') as HTMLElement
  expect(within(card).getByTestId('home-card-heading')).toHaveTextContent('Tables')
})

test('My activity: under a day heading, the kind icon, "You opened …", repeats collapsed, the clock time', async ({ admin }) => {
  const now = Date.now()
  const explore = { kind: 'page', key: 'page:explore', label: 'Cross-filter workspace', path: '/featherbase/admin/explore' }
  await admin.post('/api/events', { events: [{ ...explore, at: now - 3000 }, { ...explore, at: now - 2000 }] })
  await renderApp('/featherbase/admin', admin)
  const feed = await screen.findByTestId('activity-feed')
  const link = await within(feed).findByRole('button', { name: 'Explore' })
  const row = link.closest('[data-testid="feed-item"]') as HTMLElement
  expect(within(feed).getAllByTestId('feed-item').filter((r) => r.textContent?.includes('Explore'))).toHaveLength(1)
  // The day heading over it.
  const group = row.closest('[data-testid="feed-day-group"]') as HTMLElement
  expect(within(group).getByTestId('feed-day')).toHaveTextContent('Today')
  // The kind as a named icon, first; no avatar, no written kind pill.
  const icon = within(row).getByRole('img', { name: 'Page' })
  expect(row.firstElementChild).toBe(icon)
  expect(row.textContent).not.toMatch(/\bPAGE\b/)
  // Then the sentence…
  expect(row.textContent).toMatch(/^You opened Explore\s*· 2×/)
  // …and the clock time last.
  expect(row.lastElementChild).toBe(within(row).getByTestId('feed-time'))
  expect(within(row).getByTestId('feed-time').textContent).toMatch(/^\d{2}:\d{2}$/)
})

test('My activity titles an opened row from its values', async ({ admin }) => {
  await seedMerch(admin)
  await admin.post('/api/events', {
    events: [{ kind: 'row', key: `row:${MERCH}/${MERCH_ROW}`, label: MERCH_ROW, sub: MERCH, path: `/featherbase/admin/${MERCH}/${MERCH_ROW}` }],
  })
  await renderApp('/featherbase/admin', admin)
  const feed = await screen.findByTestId('activity-feed')
  expect(await within(feed).findByText('1517 · Kurti Z')).toBeInTheDocument()
  expect(feed).not.toHaveTextContent(MERCH_ROW)
})

test('Team tab: the same row — kind icon, "<person> changed …", role kept quietly, clock time', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Home Team DT', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  const c = await admin.post<{ updated_at: string }>('/api/save_row', { table: 'Home Team DT', row: { row_id: 'team-1', title: 'v1' } })
  await admin.post('/api/save_row', { table: 'Home Team DT', row: { row_id: 'team-1', title: 'Spring stock', updated_at: c.updated_at } })
  await renderApp('/featherbase/admin', admin)
  const feed = await screen.findByTestId('activity-feed')
  ;(await within(feed).findByTestId('feed-tab-team')).click()
  const label = await within(feed).findByText('Spring stock')
  const row = label.closest('[data-testid="feed-item"]') as HTMLElement
  expect(row.firstElementChild).toBe(within(row).getByRole('img', { name: 'Change' }))
  expect(within(row).getByTestId('feed-who')).toHaveTextContent('Administrator')
  expect(row.textContent).toMatch(/^Administrator.* changed Spring stock/)
  expect(row.lastElementChild?.textContent).toMatch(/^\d{2}:\d{2}$/)
})

test('Home headings are sentence case, not capitals', async ({ admin }) => {
  rememberOldExplore('Administrator', Date.now() - 1000)
  await renderApp('/featherbase/admin', admin)
  const strip = await screen.findByTestId('resume-strip')
  expect(within(strip).getByText('Continue where you left off')).not.toHaveClass('uppercase')
  expect(within(strip).getByText('Last view')).not.toHaveClass('uppercase')
})

test('the sidebar heads its list "Recently opened", and each item leads with a grey kind icon', async ({ admin }) => {
  rememberOldExplore('Administrator', Date.now() - 1000)
  await renderApp('/featherbase/admin', admin)
  const recent = await screen.findByTestId('sidebar-recent', {}, SIDEBAR_WAIT)
  const heading = screen.getByTestId('sidebar-recents-heading')
  expect(heading.tagName).toBe('H2')
  expect(heading).toHaveTextContent(/^Recently opened$/)
  expect(heading.closest('a')).toBeNull()
  const icon = within(recent).getByRole('img', { name: 'Page' })
  expect(icon).toHaveClass('text-ink-subtle')
})

// The sidebar's lower half: two labelled groups, headed like "Recently opened".
const groupLinks = (testid: string) =>
  within(screen.getByTestId(testid)).getAllByRole('link').map((a) => a.textContent?.trim())

test('a System Manager sees Data and People and access, each link with a grey icon', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  await screen.findByTestId('sidebar-group-data')
  const data = screen.getByTestId('sidebar-group-data')
  expect(within(data).getByTestId('sidebar-group-heading')).toHaveTextContent(/^Data$/)
  expect(within(data).getByTestId('sidebar-group-heading').tagName).toBe('H2')
  expect(groupLinks('sidebar-group-data')).toEqual(['Explore', 'All tables', 'Past imports'])
  const access = screen.getByTestId('sidebar-group-access')
  expect(within(access).getByTestId('sidebar-group-heading')).toHaveTextContent(/^People and access$/)
  // #489 item 6: Sign-in methods is in the Account menu only.
  expect(groupLinks('sidebar-group-access')).toEqual(['Access tokens', 'Waiting for access'])
  for (const link of within(screen.getByTestId('admin-sidebar')).getAllByRole('link').filter((a) => a.closest('[data-testid^="sidebar-group-"]')))
    expect(within(link).getByTestId('sidebar-item-icon')).toHaveClass('text-ink-subtle')
  // Past imports is a normal nav link now; Import data stays the plain button.
  expect(screen.getByTestId('past-imports-link')).not.toHaveClass('underline')
  expect(screen.getByTestId('import-data-link').parentElement).not.toContainElement(screen.getByTestId('past-imports-link'))
})

test('a person with only a Table grant keeps today’s links, and no management ones', async ({ admin, createUser }) => {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Home Shelf Clerk' } })
  await admin.post('/api/table_def', { name: 'Home Shelf Note', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Home Shelf Note', role: 'Home Shelf Clerk', can_read: true } })
  const clerk = await createUser({ email: 'home.clerk@example.com', roles: ['Home Shelf Clerk'] })
  await renderApp('/featherbase/admin', clerk)
  await screen.findByTestId('sidebar-group-data')
  expect(groupLinks('sidebar-group-data')).toEqual(['Explore', 'All tables'])
  expect(groupLinks('sidebar-group-access')).toEqual(['Access tokens'])
})

test('Team: a sign-in reads "<person> signed in", the verb styled like every other verb', async ({ admin }) => {
  const { logActivity } = await import('server/src/audit')
  await logActivity('Administrator', 'login', { full_name: 'Administrator' })
  await renderApp('/featherbase/admin', admin)
  const feed = await screen.findByTestId('activity-feed')
  ;(await within(feed).findByTestId('feed-tab-team')).click()
  await waitFor(() => expect(within(feed).getAllByRole('img', { name: 'Sign-in' }).length).toBeGreaterThan(0))
  const row = within(feed).getAllByRole('img', { name: 'Sign-in' })[0].closest('[data-testid="feed-item"]') as HTMLElement
  const verb = within(row).getByTestId('feed-verb')
  expect(verb).toHaveTextContent(/^signed in$/)
  expect(verb).toHaveClass('text-ink-muted')
  expect(verb).not.toHaveClass('text-xs')
})

test('Recently opened holds at most five items, Frequent included', async ({ admin }) => {
  const now = Date.now()
  for (let i = 0; i < 8; i++)
    for (const back of [3, 2, 1])
      recordAction('Administrator', { kind: 'list', key: `list:T${i}?`, label: `T${i}`, path: `/featherbase/admin/T${i}` }, now - i * 10_000 - back * 1000)
  await renderApp('/featherbase/admin', admin)
  await screen.findAllByTestId('sidebar-recent', {}, SIDEBAR_WAIT)
  const items = [...screen.queryAllByTestId('sidebar-recent'), ...screen.queryAllByTestId('sidebar-frequent')]
  expect(items).toHaveLength(5)
})

// #489 items 2 and 9 replace #476's phone label ("Home"): the selector's
// current entry is the shared top bar's name, "Featherbase Admin", at every
// width; a phone cuts it with an ellipsis rather than dropping words.
test('the app selector reads Featherbase Admin, on a phone as on a wide screen', async ({ admin }) => {
  const { PHONE_QUERY } = await import('../src/components/TopBar')
  const phone = (matches: boolean) =>
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
      matches: matches && q === PHONE_QUERY, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList)
  phone(true)
  const first = await renderApp('/featherbase/admin', admin)
  const select = (await screen.findByRole('combobox', { name: 'Switch application' })) as HTMLSelectElement
  expect(select.selectedOptions[0].textContent).toBe('Featherbase Admin')
  first.unmount()
  vi.restoreAllMocks()
  phone(false)
  await renderApp('/featherbase/admin', admin)
  const wide = (await screen.findByRole('combobox', { name: 'Switch application' })) as HTMLSelectElement
  expect(wide.selectedOptions[0].textContent).toBe('Featherbase Admin')
  vi.restoreAllMocks()
})

// Siraj, 26-Oct (#476): the row page's heading read "Store Section: sec-001"
// although the Table names a title column. It uses the same row title as
// Home and the feed, and updates after a save.
test('the row page heading reads the row title, not its id', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Store Section', id_pattern: 'prompt', title_column: 'section_name',
    columns: [{ column_name: 'store_code', column_type: 'Data' }, { column_name: 'section_name', column_type: 'Data' }],
  })
  await admin.post('/api/save_row', { table: 'Store Section', row: { row_id: 'sec-001', store_code: '1517', section_name: 'Kurti' } })
  await renderApp('/featherbase/admin/Store%20Section/sec-001', admin)
  const heading = await screen.findByRole('heading', { level: 1 })
  await waitFor(() => expect(heading).toHaveTextContent('Store Section: Kurti'))
  expect(heading).not.toHaveTextContent('sec-001')
  expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('Kurti')
})

test('a row whose Table has no title column is headed by its readable values', async ({ admin }) => {
  await seedMerch(admin)
  await renderApp(`/featherbase/admin/${encodeURIComponent(MERCH)}/${encodeURIComponent(MERCH_ROW)}`, admin)
  const heading = await screen.findByRole('heading', { level: 1 })
  await waitFor(() => expect(heading).toHaveTextContent(`${MERCH}: 1517 · Kurti Z`))
})
