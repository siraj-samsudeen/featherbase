// The bar's two actions that leave the page: Open Admin (#489) and Log out
// (#411). Gaps the merged web coverage report (ADR 0012) showed: Open Admin
// was only ever looked at, never pressed, and no test met a sign-out the
// server could not complete. The failures are real: a grant withdrawn after
// the page loaded, and a database that refuses to record the sign-out.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { SIGN_OUT_INCOMPLETE, getToken } from '../src/lib/api'
import { sql } from 'server/src/db'
import { config } from 'server/src/config'
import { parseInstanceAddresses } from 'server/src/instance-addresses'
import { test, expect, renderApp } from './pg-test'

afterEach(() => {
  config.instanceAddresses = null
  vi.restoreAllMocks()
})

const pathOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

// #501: Open Admin is offered only on an app's address, and pressing it hands the
// session over to the Admin's own address.
test("Open Admin on an app's address hands the person over to the Admin's address", async ({ admin }) => {
  config.instanceAddresses = parseInstanceAddresses(
    JSON.stringify([
      { address: 'http://localhost', opens: 'feather_dash', emails: true },
      { address: 'http://elsewhere.example.test', opens: 'admin' },
    ]),
    'test',
  )
  const real = globalThis.fetch
  const answers: Array<{ handoff?: string }> = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const res = await real(input, init)
    if (String(input).includes('/api/open_admin')) answers.push(await res.clone().json())
    return res
  })
  vi.spyOn(console, 'error').mockImplementation(() => {}) // jsdom cannot follow a cross-address navigation
  await renderApp('/featherbase/sales-target', admin)
  await userEvent.click(await within(await screen.findByTestId('top-bar')).findByTestId('open-admin', {}, { timeout: 8000 }))
  await waitFor(() => expect(answers).toHaveLength(1))
  expect(answers[0].handoff).toMatch(/^http:\/\/elsewhere\.example\.test\//)
})

test('Open Admin refused because the grant went meanwhile stays on the page, ready to try again', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Tba Note', columns: [{ column_name: 'note', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Tba Clerk' } })
  const grant = (await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Tba Note', role: 'Tba Clerk', can_read: true } })) as { row_id: string }
  const clerk = await createUser({ roles: ['Tba Clerk'] })
  // The account page on the Feather Dash address offers Open Admin to her.
  config.instanceAddresses = parseInstanceAddresses(
    JSON.stringify([
      { address: 'http://localhost', opens: 'feather_dash', emails: true },
      { address: 'http://elsewhere.example.test', opens: 'admin' },
    ]),
    'test',
  )
  const r = await renderApp('/featherbase/account/sign-in-methods', clerk)
  const button = await within(await screen.findByTestId('top-bar')).findByTestId('open-admin', {}, { timeout: 8000 })
  await admin.delete(`/api/table/Permission/${encodeURIComponent(grant.row_id)}`)
  await userEvent.click(button)
  await waitFor(() => expect(button).toBeEnabled())
  expect(pathOf(r)).toBe('/featherbase/account/sign-in-methods')
})

test('a sign-out the server could not complete says so and keeps the person signed in', async ({ admin }) => {
  // The server records a sign-out in revoked_session; make that write fail.
  await sql.unsafe(`create function featherbase.tba_refuse() returns trigger language plpgsql as $$
    begin raise exception 'storage unavailable'; end $$`)
  await sql.unsafe('create trigger tba_refuse before insert on featherbase.revoked_session for each row execute function featherbase.tba_refuse()')
  const told = vi.spyOn(window, 'alert').mockImplementation(() => {})
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  // Start on a named page: an instance can legitimately choose another Home
  // for /admin. This test promises that refused sign-out preserves THIS page.
  const r = await renderApp('/featherbase/admin/home/system', admin)
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/home/system'))
  await userEvent.click(await screen.findByTestId('session-user', {}, { timeout: 8000 }))
  await userEvent.click(await screen.findByTestId('logout'))
  await waitFor(() => expect(told).toHaveBeenCalledWith(SIGN_OUT_INCOMPLETE))
  expect(getToken()).toBe(admin.token)
  expect(pathOf(r)).toBe('/featherbase/admin/home/system')
  expect(errors).toHaveBeenCalledWith('sign-out: revoking a session failed', expect.anything())
})
