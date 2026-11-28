// #1008, reshaped by #1236 (option A, 16-Nov-2026): the app switcher lists only
// the apps a person can open, a System Manager's included. A System Manager
// learns who an installed app opens for on Admin → Apps instead.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resolve } from 'node:path'
import { discoverPackages } from 'server/src/runtime-packages'
import { test, expect, renderApp } from './pg-test'
import { appChoices } from './app-switcher'

const WAIT = { timeout: 10_000 }
type Admin = Parameters<typeof renderApp>[1]

async function installTasker(admin: Admin) {
  await discoverPackages([resolve('../..', 'example-apps/tasker')])
  await admin.post('/api/install_app', { name: 'tasker' })
}

test('a System Manager without the role does not find the app in the switcher, and Apps says who it opens for', async ({ admin, createUser }) => {
  await installTasker(admin)
  const manager = await createUser({ roles: ['System Manager'] })
  await renderApp('/featherbase/admin', manager)
  await waitFor(async () => expect((await appChoices(screen, WAIT)).length).toBeGreaterThan(0), WAIT)
  expect(await appChoices(screen, WAIT)).not.toContain('Tasker')
  expect(screen.queryByTestId('app-switcher-closed')).toBeNull()

  await renderApp('/featherbase/admin/apps', manager)
  // The Apps page shows one app's details: choose Tasker in its list.
  await userEvent.click(await screen.findByRole('button', { name: /Tasker/ }, WAIT))
  const tasker = await screen.findByRole('region', { name: 'Tasker details' }, WAIT)
  expect(within(tasker).getByTestId('app-opens-for')).toHaveTextContent(/^Opens for: Tasker Member\b/)
})

test('a System Manager holding the role finds the app in the switcher as usual', async ({ admin, createUser }) => {
  await installTasker(admin)
  const manager = await createUser({ roles: ['System Manager', 'Tasker Member'] })
  await renderApp('/featherbase/admin', manager)
  await waitFor(async () => expect(await appChoices(screen, WAIT)).toContain('Tasker'), WAIT)
})

test("someone who isn't a System Manager keeps the shorter list", async ({ admin, createUser }) => {
  await installTasker(admin)
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Sw Note', columns: [{ column_name: 'note', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Sw Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Sw Note', role: 'Sw Reader', operation: 'read', scope_mode: 'all' } })
  const reader = await createUser({ roles: ['Sw Reader'] })
  await renderApp('/featherbase/admin', reader)
  await waitFor(async () => expect((await appChoices(screen, WAIT)).length).toBeGreaterThan(0), WAIT)
  expect(await appChoices(screen, WAIT)).not.toContain('Tasker')
})
