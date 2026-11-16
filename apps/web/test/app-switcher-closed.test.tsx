// #1008: a System Manager can tell an app is installed when they lack its role.
// The switcher lists it greyed out with the reason; everyone else's list is as it was.
import { screen, waitFor, within } from '@testing-library/react'
import { resolve } from 'node:path'
import { discoverPackages } from 'server/src/runtime-packages'
import { test, expect, renderApp } from './pg-test'
import { appChoices, closedChoices, openSwitcher } from './app-switcher'

const WAIT = { timeout: 10_000 }
type Admin = Parameters<typeof renderApp>[1]

async function installTasker(admin: Admin) {
  await discoverPackages([resolve('../..', 'example-apps/tasker')])
  await admin.post('/api/install_app', { name: 'tasker' })
}


test('a System Manager without the role sees the app greyed out, with the reason', async ({ admin, createUser }) => {
  await installTasker(admin)
  const manager = await createUser({ roles: ['System Manager'] })
  await renderApp('/featherbase/admin', manager)
  await waitFor(async () => expect(await closedChoices(screen, WAIT)).toEqual(['Tasker']), WAIT)
  const { menu } = await openSwitcher(screen, WAIT)
  const closed = menu.querySelector('[data-testid="app-switcher-closed"]')!
  expect(closed).toHaveAttribute('aria-disabled', 'true')
  expect(closed).toHaveTextContent('you need the Tasker Member role')
})

test('a System Manager holding the role sees the app as usual', async ({ admin, createUser }) => {
  await installTasker(admin)
  const manager = await createUser({ roles: ['System Manager', 'Tasker Member'] })
  await renderApp('/featherbase/admin', manager)
  await waitFor(async () => expect(await appChoices(screen, WAIT)).toContain('Tasker'), WAIT)
  expect(await closedChoices(screen, WAIT)).toEqual([])
})

test("someone who isn't a System Manager keeps the shorter list and never asks for the closed one", async ({ admin, createUser }) => {
  await installTasker(admin)
  await admin.post('/api/table_def', { name: 'Sw Note', columns: [{ column_name: 'note', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Sw Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Sw Note', role: 'Sw Reader', operation: 'read', scope_mode: 'all' } })
  const reader = await createUser({ roles: ['Sw Reader'] })
  await renderApp('/featherbase/admin', reader)
  await waitFor(async () => expect((await appChoices(screen, WAIT)).length).toBeGreaterThan(0), WAIT)
  expect(await appChoices(screen, WAIT)).not.toContain('Tasker')
  expect(await closedChoices(screen, WAIT)).toEqual([])
})
