// Proves the web testing chain: jsdom → real router → real components →
// fetch bridge → in-process Hono → sandboxed Postgres, and back.

import { screen } from '@testing-library/react'
import { test, expect, renderDesk, renderSession } from './pg-test'

let leakedName = ''

test('the login page renders through the real route tree', async () => {
  await renderDesk('/login', { user: null, token: null } as never)
  expect(await screen.findByText('Sign in to your account')).toBeInTheDocument()
})

test('the Desk renders a DocType list with data seeded through the API', async ({
  admin,
  seed,
}) => {
  const doc = await seed('ToDo', {
    description: 'Review the DW sales mismatch',
    allocated_to: 'Administrator',
  })
  await renderDesk('/desk/ToDo', admin)
  expect(await screen.findByTestId('doctype-page')).toBeInTheDocument()
  expect(await screen.findByText(doc.name)).toBeInTheDocument()
})

test('the Session DSL drives the page', async ({ admin, seed }) => {
  const doc = await seed('ToDo', {
    description: 'Only visible inside this sandbox',
    allocated_to: 'Administrator',
  })
  leakedName = doc.name
  const { session } = await renderSession('/desk/ToDo', admin)
  await session.assertText(doc.name).refuteText('No such row')
})

test("previous test's seed rolled back — its ToDo is gone from the list", async ({ admin }) => {
  expect(leakedName).toBeTruthy()
  await renderDesk('/desk/ToDo', admin)
  await expect(screen.findByTestId('doctype-page')).resolves.toBeInTheDocument()
  await new Promise((r) => setTimeout(r, 150))
  expect(screen.queryByText(leakedName)).not.toBeInTheDocument()
})
