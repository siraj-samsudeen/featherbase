// #923: roles System Settings gives everyone who signs in. A person holds them
// without having them in their own list, so their access page and their Person
// form both say where they come from.
import { screen, waitFor } from '@testing-library/react'
import { rowHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const WAIT = { timeout: 10_000 }

async function seed(admin: Admin) {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Ew Member' } })
  await admin.post('/api/save_row', { table: 'System Settings', row: { everyone_roles: 'Ew Member' } })
}

test("a person's access page says a role comes from everyone who signs in", async ({ admin, createUser }) => {
  await seed(admin)
  const person = await createUser({ roles: [], fullName: 'Ew Person' })
  await renderApp(`/featherbase/account/access/${encodeURIComponent(person.user!)}`, admin)
  const role = await screen.findByTestId('access-role', {}, WAIT)
  expect(role).toHaveTextContent('Ew Member — everyone who signs in holds it (System Settings)')
})

test("a Person's roles say which roles everyone who signs in also holds", async ({ admin, createUser }) => {
  await seed(admin)
  const person = await createUser({ roles: [], fullName: 'Ew Person' })
  await renderApp(rowHref('Person', person.user!), admin)
  await waitFor(() => expect(screen.getByTestId('everyone-roles-note'))
    .toHaveTextContent('Everyone who signs in also holds Ew Member, set in System Settings.'), WAIT)
})
