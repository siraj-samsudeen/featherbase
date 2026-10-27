// Sign-in paths the merged web coverage report (ADR 0012) showed red: back
// from sign-up to the password form, a return path into a runtime app (a full
// page load), a person who belongs on another address (the hand-off), an
// app's own address (its landing is the app, a full page load), and a
// browser that blocks site data. jsdom cannot load another page, so a full
// load is read from jsdom's own "not implemented: navigation" report; blocked
// storage is a spy on sessionStorage only. Everything else is the real server.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { config } from 'server/src/config'
import { parseInstanceAddresses } from 'server/src/instance-addresses'
import { VIEWER_ROLE } from 'server/src/sales-target'
import { setPasswordMethod } from 'server/test/identity-fixtures'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never
type Router = { state: { location: { pathname: string } } }

afterEach(() => {
  config.instanceAddresses = null
  vi.restoreAllMocks()
})

function navigationReports() {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  return () => errors.mock.calls.filter((c) => /Not implemented: navigation/.test(String(c[0]?.message ?? c[0])))
}

async function signIn(usr: string, pwd: string) {
  await userEvent.type(await screen.findByLabelText('Email or username', {}, { timeout: 8000 }), usr)
  await userEvent.type(screen.getByLabelText('Password'), pwd)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

test('from sign-up, "I already have an account" goes back to signing in', async () => {
  await setPasswordMethod({ new_person: 'create' })
  await renderApp('/featherbase/login', anonymous)
  await userEvent.click(await screen.findByTestId('sign-up-toggle'))
  expect(screen.getByTestId('sign-up-submit')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'I already have an account' }))
  expect(await screen.findByTestId('login-form')).toBeInTheDocument()
  expect(screen.queryByTestId('sign-up-submit')).not.toBeInTheDocument()
})

test('signing in with a return path into a runtime app loads that app', async ({ admin, createUser }) => {
  const person = await createUser({ email: 'to.app@example.com', roles: ['System Manager'] })
  await admin.post('/api/set_password', { user: person.user, password: 'to-app-pw-1' })
  const reports = navigationReports()
  await renderApp(`/featherbase/login?next=${encodeURIComponent('/tasker/')}`, anonymous)
  await signIn('to.app@example.com', 'to-app-pw-1')
  await waitFor(() => expect(reports()).toHaveLength(1))
  expect(localStorage.getItem('fc_token')).not.toBeNull()
})

test('someone who belongs on another address is handed off there when they sign in', async ({ admin, createUser }) => {
  config.instanceAddresses = parseInstanceAddresses(
    JSON.stringify([
      { address: 'http://localhost', opens: 'admin', emails: true },
      { address: 'http://dash.example.test', opens: 'feather_dash' },
    ]),
    'test',
  )
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: VIEWER_ROLE } })
  const viewer = await createUser({ email: 'viewer.handoff@example.com', roles: [VIEWER_ROLE] })
  await admin.post('/api/set_password', { user: viewer.user, password: 'handoff-pw-1' })
  const reports = navigationReports()
  const { router } = await renderApp('/featherbase/login', anonymous)
  await signIn('viewer.handoff@example.com', 'handoff-pw-1')
  await waitFor(() => expect(reports()).toHaveLength(1))
  // Nothing on this address took them anywhere: the hand-off is the way on.
  expect((router as Router).state.location.pathname).toBe('/featherbase/login')
})

test('with site data blocked, a refused Google sign-in still reads plainly and a password sign-in lands on the Admin', async ({ admin, createUser }) => {
  const person = await createUser({ email: 'blocked.storage@example.com', roles: ['System Manager'] })
  await admin.post('/api/set_password', { user: person.user, password: 'blocked-pw-1' })
  const read = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (this === sessionStorage) throw new DOMException('blocked', 'SecurityError')
    return read.call(this, key)
  })
  const { router } = await renderApp('/featherbase/login?error=not_provisioned', anonymous)
  expect(await screen.findByTestId('sign-in-refused', {}, { timeout: 8000 })).toBeInTheDocument()
  await userEvent.click(screen.getByTestId('refused-other-ways'))
  await signIn('blocked.storage@example.com', 'blocked-pw-1')
  await waitFor(() => expect((router as Router).state.location.pathname).toBe('/featherbase/admin'))
})

test("signing in on an app's own address loads that app", async ({ admin, createUser }) => {
  config.instanceAddresses = parseInstanceAddresses(
    JSON.stringify([
      { address: 'http://localhost', opens: 'tasker', emails: true },
      { address: 'http://admin.example.test', opens: 'admin' },
    ]),
    'test',
  )
  const person = await createUser({ email: 'app.address@example.com' })
  await admin.post('/api/set_password', { user: person.user, password: 'app-address-pw-1' })
  const reports = navigationReports()
  await renderApp('/featherbase/login', anonymous)
  await signIn('app.address@example.com', 'app-address-pw-1')
  await waitFor(() => expect(reports()).toHaveLength(1))
  expect(JSON.parse(localStorage.getItem('fc_user')!)).toMatchObject({ landing: '/tasker/' })
})
