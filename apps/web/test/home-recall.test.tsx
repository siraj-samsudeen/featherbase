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

import { cleanup, screen, waitFor, within } from '@testing-library/react'
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
      path: '/admin/Customer',
      at: now - d * DAY,
    })
    events.push({
      kind: 'page',
      key: 'page:query-report/Sales Register',
      label: 'Sales Register',
      sub: 'Report',
      path: '/admin/query-report/Sales%20Register',
      at: now - d * DAY,
    })
  }
  return events
}

async function openHome(as: Client) {
  const rendered = await renderApp('/admin', as)
  await screen.findByTestId('home-page')
  return rendered
}

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
      '/admin/Customer',
    ),
  )
})
