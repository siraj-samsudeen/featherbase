// Proves the web testing chain: jsdom → real router → real components →
// fetch bridge → in-process Hono → sandboxed Postgres, and back.

import { screen } from '@testing-library/react'
import { test, expect, renderApp, renderSession } from './pg-test'

let leakedName = ''

test('the login page renders through the real route tree', async () => {
  await renderApp('/login', { user: null, token: null } as never)
  expect(await screen.findByText('Sign in to your account')).toBeInTheDocument()
})

test('the Admin renders a Table list with data seeded through the API', async ({
  admin,
  seed,
}) => {
  const doc = await seed('ToDo', {
    description: 'Review the DW sales mismatch',
    allocated_to: 'Administrator',
  })
  await renderApp('/admin/ToDo', admin)
  expect(await screen.findByTestId('table-page')).toBeInTheDocument()
  expect(await screen.findByText(doc.row_id)).toBeInTheDocument()
})

test('the Session DSL drives the page', async ({ admin, seed }) => {
  const doc = await seed('ToDo', {
    description: 'Only visible inside this sandbox',
    allocated_to: 'Administrator',
  })
  leakedName = doc.row_id
  const { session } = await renderSession('/admin/ToDo', admin)
  await session.assertText(doc.row_id).refuteText('No such row')
})

test("previous test's seed rolled back — its ToDo is gone from the list", async ({
  admin,
  seed,
}) => {
  expect(leakedName).toBeTruthy()
  // Positive control: seed a ToDo inside THIS test's own sandbox (rolled
  // back like every other test's, so it doesn't leak into a later test) and
  // wait for it to render. `table-page` mounts — and the list's still-empty
  // placeholder renders into it — before the list query even fires, so
  // waiting on the container alone (as before) doesn't prove a re-fetch
  // happened for this test's transaction. Anchoring on a row known to exist
  // only here is the deterministic proof the list actually queried this
  // test's data — at which point last test's leaked doc had every chance to
  // show up too, if the rollback hadn't actually erased it.
  const mine = await seed('ToDo', {
    description: 'Only visible inside this test’s own sandbox',
    allocated_to: 'Administrator',
  })
  await renderApp('/admin/ToDo', admin)
  await expect(screen.findByTestId('table-page')).resolves.toBeInTheDocument()
  expect(await screen.findByText(mine.row_id)).toBeInTheDocument()
  expect(screen.queryByText(leakedName)).not.toBeInTheDocument()
})
