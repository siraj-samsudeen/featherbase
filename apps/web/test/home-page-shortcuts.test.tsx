// A Home Page's legacy shortcuts of the report and address kinds, a Home Page
// or Dashboard address that names nothing, and the Activity feed's way back
// to "My activity" and to the page an item names. Gaps the merged web coverage report (ADR 0012) showed —
// e2e/home-page.spec.ts drives the table and dashboard kinds only. A listing
// the server fails to answer is a real failure: a table renamed away in the
// test's transaction.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const pathOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

async function seedHomePage(admin: Admin) {
  await admin.post('/api/save_row', {
    table: 'Home Page',
    row: {
      row_id: 'hps-sales',
      label: 'Sales',
      shortcuts: JSON.stringify([
        { label: 'Weekly', type: 'report', link_to: 'Hps Weekly' },
        { label: 'All tables', type: 'url', link_to: '/featherbase/admin/all-tables' },
      ]),
    },
  })
}

test('a report shortcut opens that report, and an address shortcut opens its address', async ({ admin }) => {
  const user = userEvent.setup()
  await seedHomePage(admin)
  const r = await renderApp('/featherbase/admin/home/hps-sales', admin)
  await user.click(await screen.findByTestId('shortcut-Weekly', {}, { timeout: 8000 }))
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/Report/Hps Weekly'))

  const back = await renderApp('/featherbase/admin/home/hps-sales', admin)
  await user.click(await screen.findByTestId('shortcut-All tables', {}, { timeout: 8000 }))
  await waitFor(() => expect(pathOf(back)).toBe('/featherbase/admin/all-tables'))
})

test('a Home Page address that names no Home Page says so', async ({ admin }) => {
  await renderApp('/featherbase/admin/home/hps-no-such-page', admin)
  expect(await screen.findByTestId('home-page-error', {}, { timeout: 8000 })).toHaveTextContent('Home Page not found')
})

test('a Dashboard address that names no Dashboard says so', async ({ admin }) => {
  await renderApp('/featherbase/admin/dashboard/hps-no-such-board', admin)
  expect(await screen.findByTestId('dashboard-error', {}, { timeout: 8000 })).toHaveTextContent(/not found/i)
})

test('the activity feed goes from Team back to My activity', async ({ admin }) => {
  const user = userEvent.setup()
  await seedHomePage(admin)
  await renderApp('/featherbase/admin/home/hps-sales', admin)
  await user.click(await screen.findByTestId('feed-tab-team', {}, { timeout: 8000 }))
  await waitFor(() => expect(screen.getByTestId('feed-tab-team')).toHaveAttribute('aria-pressed', 'true'))
  await user.click(screen.getByTestId('feed-tab-mine'))
  await waitFor(() => expect(screen.getByTestId('feed-tab-mine')).toHaveAttribute('aria-pressed', 'true'))
})

test('an item in the activity feed opens the page it names', async ({ createUser }) => {
  const user = userEvent.setup()
  const me = await createUser({ roles: ['System Manager'] })
  await me.post('/api/events', {
    events: [{ kind: 'list', key: 'list:all-tables?', label: 'all-tables', path: '/featherbase/admin/all-tables' }],
  })
  const r = await renderApp('/featherbase/admin', me)
  const feed = await screen.findByTestId('activity-feed', {}, { timeout: 8000 })
  await waitFor(() => expect(within(feed).getAllByTestId('feed-item')).toHaveLength(1))
  await user.click(within(feed).getByTestId('feed-object'))
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/all-tables'))
})

test('when the server cannot list the Home Pages, the page says so', async ({ admin }) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await seedHomePage(admin)
  // The listing reads this table; renamed away inside the test's transaction, it fails.
  await sql.unsafe('alter table featherbase.home_page rename to home_page_gone')
  await renderApp('/featherbase/admin/home/hps-sales', admin)
  expect(await screen.findByTestId('home-page-error', {}, { timeout: 8000 })).toHaveTextContent('Could not load Home Pages')
  vi.restoreAllMocks()
})
