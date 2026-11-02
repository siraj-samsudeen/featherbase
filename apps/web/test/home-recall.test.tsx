// #101 Phase 5: the Home Page notices a routine — destinations opened on many
// distinct days — and offers to pin it as a workspace. Pushed down from
// e2e/home-recall.spec.ts (#223 batch 1). The spec needed a dedicated
// committed user precisely so its five-day seeded trail would not pollute
// Administrator's feed; inside a sandbox transaction the trail rolls back and
// that whole precaution disappears.
//
// The card and the chip row are mutually exclusive states of one component,
// so the tests walk them separately: no routine (nothing offered), a routine
// (offered), pinned (chips replace the card), reloaded (chips survive), and
// a chip click (navigates). One claim each.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, createRouter, RouterContextProvider } from '@tanstack/react-router'
import { ResumeStrip, RoutineCard } from '../src/components/HomeRecall'
import { clearSession, setSession } from '../src/lib/api'
import { recordAction } from '../src/lib/recents'
import { test, expect, renderApp } from './pg-test'

const DAY = 86_400_000
type Client = Parameters<typeof renderApp>[1]

/** A habit: two destinations opened on `days` distinct days, all inside the
 *  server's 7-day trust window for client-supplied timestamps. */
function habit(days: number) {
  const now = Date.now()
  const events = []
  for (let d = 1; d <= days; d++) {
    events.push({
      kind: 'list',
      key: 'list:Customer?rtn',
      label: 'Customer',
      sub: 'region = South',
      path: '/featherbase/admin/Customer',
      at: now - d * DAY,
    })
    events.push({
      kind: 'page',
      key: 'page:script-report/Sales Register',
      label: 'Sales Register',
      sub: 'Report',
      path: '/featherbase/admin/script-report/Sales%20Register',
      at: now - d * DAY,
    })
  }
  return events
}

async function openHome(as: Client) {
  const rendered = await renderApp('/featherbase/admin', as)
  await screen.findByTestId('home-page')
  return rendered
}

test('signing out hides the previous person’s recalled destinations and routine', async ({ admin }) => {
  await admin.post('/api/events', { events: habit(5) })
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  recordAction(admin.user!, { kind: 'list', key: 'list:Private Work', label: 'Private Work', path: '/featherbase/admin/Private%20Work' })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({ routeTree: createRootRoute() })
  const content = () => <QueryClientProvider client={client}><RouterContextProvider router={router}>
    <ResumeStrip /><RoutineCard />
  </RouterContextProvider></QueryClientProvider>
  const view = render(content())
  expect(await screen.findByTestId('resume-strip')).toHaveTextContent('Private Work')
  await screen.findByTestId('routine-card')
  clearSession()
  view.rerender(content())
  expect(view.container).toBeEmptyDOMElement()
})

test('a user with no habit is offered no routine at all', async ({ createUser }) => {
  const user = await createUser({ roles: ['System Manager'] })
  await openHome(user)
  // Positive control: the page settled far enough to have asked.
  await waitFor(async () =>
    expect((await user.get('/api/routine_suggestion')) as { targets: unknown[] }).toMatchObject({
      targets: [],
    }),
  )
  expect(screen.queryByTestId('routine-card')).not.toBeInTheDocument()
  expect(screen.queryByTestId('workspace-chips')).not.toBeInTheDocument()
})

test('a five-day habit surfaces both destinations as a routine', async ({ createUser }) => {
  const user = await createUser({ roles: ['System Manager'] })
  await user.post('/api/events', { events: habit(5) })

  await openHome(user)
  const card = await screen.findByTestId('routine-card')
  expect(card).toHaveTextContent('Customer')
  expect(card).toHaveTextContent('Sales Register')
})

test('pinning replaces the card with a chip for each destination', async ({ createUser }) => {
  const user = await createUser({ roles: ['System Manager'] })
  await user.post('/api/events', { events: habit(5) })

  await openHome(user)
  ;(await screen.findByTestId('routine-pin')).click()

  const chips = await screen.findByTestId('workspace-chips')
  expect(within(chips).getAllByTestId('workspace-chip').map((c) => c.textContent)).toEqual([
    'Customer· region = South',
    'Sales Register· Report',
  ])
  expect(screen.queryByTestId('routine-card')).not.toBeInTheDocument()
})

test('the pin survives a fresh mount — the card does not come back', async ({ createUser }) => {
  const user = await createUser({ roles: ['System Manager'] })
  await user.post('/api/events', { events: habit(5) })

  await openHome(user)
  ;(await screen.findByTestId('routine-pin')).click()
  await screen.findByTestId('workspace-chips')

  cleanup()
  await openHome(user)
  expect(await screen.findByTestId('workspace-chips')).toBeInTheDocument()
  expect(screen.queryByTestId('routine-card')).not.toBeInTheDocument()
})

test('clicking a chip navigates to the destination it stands for', async ({ createUser }) => {
  const user = await createUser({ roles: ['System Manager'] })
  await user.post('/api/events', { events: habit(5) })

  const { router } = await openHome(user)
  ;(await screen.findByTestId('routine-pin')).click()
  const chips = await screen.findByTestId('workspace-chips')

  within(chips).getAllByTestId('workspace-chip')[0].click()
  await waitFor(() =>
    expect((router.state as { location: { pathname: string } }).location.pathname).toBe(
      '/featherbase/admin/Customer',
    ),
  )
})

// Merged web coverage (ADR 0012): "Not now", the Last view tile, and a pinned
// workspace this version cannot read.
test('"Not now" puts the routine away, and it stays away on the next visit', async ({ createUser }) => {
  const user = await createUser({ roles: ['System Manager'] })
  await user.post('/api/events', { events: habit(5) })
  await openHome(user)
  ;(await screen.findByTestId('routine-dismiss')).click()
  await waitFor(() => expect(screen.queryByTestId('routine-card')).not.toBeInTheDocument())
  expect(screen.queryByTestId('workspace-chips')).not.toBeInTheDocument()
  cleanup()
  await openHome(user)
  await waitFor(() => expect(screen.queryByTestId('routine-card')).not.toBeInTheDocument())
})

test('the Last view tile opens the list it names', async ({ createUser }) => {
  const user = await createUser({ roles: ['System Manager'] })
  const { recordAction } = await import('../src/lib/recents')
  recordAction(user.user!, { kind: 'list', key: 'list:Person?', label: 'Person', path: '/featherbase/admin/Person' })
  const { router } = await openHome(user)
  ;(await screen.findByTestId('resume-tile-view')).click()
  await waitFor(() =>
    expect((router.state as { location: { pathname: string } }).location.pathname).toBe('/featherbase/admin/Person'),
  )
})

test('a pinned workspace this version cannot read counts as none, so the routine is offered again', async ({ createUser }) => {
  const user = await createUser({ roles: ['System Manager'] })
  await user.post('/api/events', { events: habit(5) })
  localStorage.setItem(`fc-workspace:${user.user}`, '{not json')
  await openHome(user)
  expect(await screen.findByTestId('routine-card')).toBeInTheDocument()
  expect(screen.queryByTestId('workspace-chips')).not.toBeInTheDocument()
})

// "Tiles back to what the user was just doing" (dashboards-and-home-pages):
// the trail is made in the app itself — a row opened, a list opened, a search
// run — and the home page then offers one tile back to each.
test('after opening a row, then a list, then running a search, the home page has a tile back to each', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Hr Shelf',
    id_pattern: 'prompt',
    title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', { name: 'Hr Aisle', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] })
  await admin.post('/api/save_row', { table: 'Hr Shelf', row: { row_id: 'shelf-quokka', title: 'Quokka shelf' } })
  const here = (r: { router: unknown }) =>
    decodeURIComponent((r.router as { state: { location: { pathname: string } } }).state.location.pathname)

  const app = await renderApp('/featherbase/admin/Hr%20Shelf/shelf-quokka', admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await app.router.navigate({ to: '/featherbase/admin/Hr%20Aisle' })
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
  const bar = screen.getByLabelText('Search or type a command')
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Quokka' } })
  fireEvent.click(await screen.findByTestId('awesomebar-doc'))
  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/Hr Shelf/shelf-quokka'))

  await app.router.navigate({ to: '/featherbase/admin' })
  const strip = await screen.findByTestId('resume-strip', {}, { timeout: 8000 })
  expect(within(strip).getByTestId('resume-tile-row')).toHaveTextContent('Quokka shelf')
  expect(within(strip).getByTestId('resume-tile-view')).toHaveTextContent('Hr Aisle')
  expect(within(strip).getByTestId('resume-tile-search')).toHaveTextContent('Quokka')

  // One click each.
  within(strip).getByTestId('resume-tile-view').click()
  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/Hr Aisle'))
  await app.router.navigate({ to: '/featherbase/admin' })
  ;(await screen.findByTestId('resume-tile-row')).click()
  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/Hr Shelf/shelf-quokka'))
  await app.router.navigate({ to: '/featherbase/admin' })
  ;(await screen.findByTestId('resume-tile-search')).click()
  await waitFor(() => expect(screen.getByLabelText('Search or type a command')).toHaveValue('Quokka'))
}, 30000)

// SPEC: Pin a routine as shortcuts — "shortcuts that stay on the home page
// until the user unpins them" (#548). The pinned row has its own unpin
// control; once used, the pin is gone on the next visit too, and the same
// routine isn't offered again until it changes.
test('a pinned routine can be unpinned, and stays unpinned on the next visit', async ({ createUser }) => {
  const user = await createUser({ roles: ['System Manager'] })
  await user.post('/api/events', { events: habit(5) })
  await openHome(user)
  ;(await screen.findByTestId('routine-pin')).click()
  const chips = await screen.findByTestId('workspace-chips')

  within(chips).getByRole('button', { name: /unpin/i }).click()
  await waitFor(() => expect(screen.queryByTestId('workspace-chips')).not.toBeInTheDocument())
  // Unpinning is an answer: the same routine is not offered again straight away.
  expect(screen.queryByTestId('routine-card')).not.toBeInTheDocument()
  cleanup()
  await openHome(user)
  await waitFor(async () =>
    expect((await user.get('/api/routine_suggestion')) as { targets: unknown[] }).not.toMatchObject({ targets: [] }),
  )
  expect(screen.queryByTestId('workspace-chips')).not.toBeInTheDocument()
})
