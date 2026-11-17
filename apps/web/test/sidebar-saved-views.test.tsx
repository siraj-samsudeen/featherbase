// #1229: the Admin sidebar's "Saved views" — the person's own views and the
// shared ones they starred, one click each. The read's rules (Tables the person
// can read, private or deleted views dropping out) are the server's
// (apps/server/test/saved-views-sidebar.test.ts).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableHref } from 'shared'
import { afterEach, vi } from 'vitest'
import { holdResponses } from './held-requests'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DEPT = 'Ssv Department'
const T = { timeout: 10_000 }
const ATK = ['store', '=', 'Attakulangara']

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DEPT, id_pattern: 'prompt', title_column: 'dept_name',
    columns: [
      { column_name: 'dept_name', column_type: 'Data', label: 'Department', in_list_view: true },
      { column_name: 'store', column_type: 'Data', label: 'Store', in_list_view: true },
    ],
  })
}

const group = () => screen.findByTestId('sidebar-saved-views', {}, T)

test("a person's own saved view is in the sidebar and opens its list with the view's filters", async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/saved_views', { table: DEPT, label: 'ATK Departments', filters: [ATK], shared: true })
  await renderApp('/featherbase/admin', admin)
  const row = await within(await group()).findByRole('link', { name: /ATK Departments/ }, T)
  // #1253 (style A): one line; the view's table is in its tooltip.
  expect(row.getAttribute('title')).toContain(DEPT)

  await userEvent.click(row)
  // The Department list, with the view's one filter on.
  expect(await screen.findByTestId('table-page', {}, T)).toBeInTheDocument()
  const [chip, ...more] = await screen.findAllByTestId('filter-chip', {}, T)
  expect(more).toHaveLength(0)
  expect(chip).toHaveTextContent('Attakulangara')
})

test('a saved view clicked with a modifier key is left to the browser', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/saved_views', { table: DEPT, label: 'ATK Departments', filters: [ATK], shared: true })
  const r = await renderApp('/featherbase/admin', admin)
  const row = await within(await group()).findByRole('link', { name: /ATK Departments/ }, T)
  const user = userEvent.setup()
  await user.keyboard('{Control>}')
  await user.click(row)
  await user.keyboard('{/Control}')
  expect((r.router.state as { location: { pathname: string } }).location.pathname).toBe('/featherbase/admin')
})

test('with no saved views the group is not shown', async ({ admin }) => {
  await seed(admin)
  await renderApp('/featherbase/admin', admin)
  await screen.findByTestId('admin-sidebar', {}, T)
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByTestId('sidebar-saved-views')).not.toBeInTheDocument()
})

test("starring someone else's shared view on the list puts it in the sidebar, and unstarring takes it out", async ({ admin, createUser }) => {
  await seed(admin)
  await admin.post('/api/saved_views', { table: DEPT, label: 'ATK Departments', filters: [ATK], shared: true })
  const manager = await createUser({ email: 'ssv.manager@example.test', roles: ['System Manager'] })
  await renderApp(tableHref(DEPT), manager)
  const star = await screen.findByTestId('saved-view-star', {}, T)
  expect(star).toHaveAccessibleName('Add ATK Departments to the sidebar')
  expect(screen.queryByTestId('sidebar-saved-views')).not.toBeInTheDocument()

  await userEvent.click(star)
  expect((await within(await group()).findByRole('link', { name: /ATK Departments/ }, T)).getAttribute('title')).toContain('Shared with you')
  expect(star).toHaveAccessibleName('Remove ATK Departments from the sidebar')

  await userEvent.click(star)
  await waitFor(() => expect(screen.queryByTestId('sidebar-saved-views')).not.toBeInTheDocument(), T)
})

test('the star is offered only on shared views of other people', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/saved_views', { table: DEPT, label: 'Mine', filters: [ATK], shared: true })
  await renderApp(tableHref(DEPT), admin)
  await screen.findAllByTestId('saved-view-chip', {}, T)
  expect(screen.queryByTestId('saved-view-star')).not.toBeInTheDocument()
})

afterEach(() => vi.restoreAllMocks())

// Codex review, round 3: a star changed before the person's stars are known
// would save a list of one and overwrite the rest.
test("the star waits for the person's settings, and stays off when they cannot be read", async ({ admin, createUser }) => {
  await seed(admin)
  await admin.post('/api/saved_views', { table: DEPT, label: 'ATK Departments', filters: [ATK], shared: true })
  const manager = await createUser({ email: 'ssv.wait@example.test', roles: ['System Manager'] })
  const settings = holdResponses('/api/user_settings/__navigation')
  await renderApp(tableHref(DEPT), manager)
  const star = await screen.findByTestId('saved-view-star', {}, T)
  await settings.asked
  expect(star).toBeDisabled()
  settings.release()
  await waitFor(() => expect(screen.getByTestId('saved-view-star')).toBeEnabled(), T)
})

test("with the person's settings unreadable, no star can be changed", async ({ admin, createUser }) => {
  await seed(admin)
  await admin.post('/api/saved_views', { table: DEPT, label: 'ATK Departments', filters: [ATK], shared: true })
  const manager = await createUser({ email: 'ssv.unread@example.test', roles: ['System Manager'] })
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (path.includes('/api/user_settings/__navigation') && (!init?.method || init.method === 'GET')) return new Response('{}', { status: 503 })
    return real(input, init)
  })
  await renderApp(tableHref(DEPT), manager)
  const star = await screen.findByTestId('saved-view-star', {}, T)
  await new Promise((r) => setTimeout(r, 300))
  expect(star).toBeDisabled()
})

// Codex review, round 3: a view saved while the sidebar's first read is out must
// still appear: that read's answer from before the save is not the last word.
test("a view saved while the sidebar's first read is out still appears in the sidebar", async ({ admin }) => {
  await seed(admin)
  let deliver!: () => void
  const late = new Promise<void>((resolve) => { deliver = resolve })
  let first = true
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!path.includes('/api/saved_views/sidebar') || !first) return real(input, init)
    first = false
    // Answered now (no views yet), delivered after the save.
    const answer = await real(input, init)
    await late
    return answer
  })
  await renderApp(`${tableHref(DEPT)}?filters=${encodeURIComponent(JSON.stringify([ATK]))}`, admin)
  await userEvent.click(await screen.findByTestId('save-view-open', {}, T))
  await userEvent.type(await screen.findByTestId('nudge-name', {}, T), 'ATK Departments')
  await userEvent.click(screen.getByTestId('nudge-save'))
  expect(await screen.findByTestId('saved-view-chip', {}, T)).toHaveTextContent('ATK Departments')
  deliver()
  expect(await within(await group()).findByRole('link', { name: /ATK Departments/ }, T)).toBeInTheDocument()
})
