// First-run setup reached through the real sign-in page (#465, task 6.1;
// checklist on #465). The other first-run files set the sign-in offer by
// hand; here the Administrator signs in through the form, as a person does.
// Moved from e2e/first-run-setup.spec.ts (#1080).
import { afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { setUserPassword } from 'server/src/auth'
import { test, expect, renderApp } from './pg-test'

afterEach(() => {
  vi.restoreAllMocks()
  try { sessionStorage.clear() } catch { /* storage blocked */ }
})

const anonymous = { user: null, token: null } as never
const SETUP = '/featherbase/admin/setup/person'
const PASSWORD = 'first-run-admin-pw'
const pathOf = (router: unknown) => (router as { state: { location: { pathname: string } } }).state.location.pathname

/** No System Manager has an address, and nothing else is failing. */
async function freshInstance() {
  await sql`update person set email = null where row_id in (select parent from has_role where role = 'System Manager')`
  await sql`update sign_in_method set enabled = true, allowed_email_domains = 'example.com' where kind = 'google'`
  await sql`update scheduled_job set enabled = false`
  await setUserPassword('Administrator', PASSWORD)
}

async function signInAsAdministrator() {
  await userEvent.type(await screen.findByLabelText('Email or username'), 'Administrator')
  await userEvent.type(screen.getByLabelText('Password'), PASSWORD)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

test('signing in, the Administrator can defer the welcome guide and resume it, and optional setup is no fault', async () => {
  await freshInstance()
  await renderApp('/featherbase/login', anonymous)
  await signInAsAdministrator()
  const welcome = await screen.findByTestId('welcome-setup', {}, { timeout: 8000 })
  expect(within(welcome).getByRole('heading', { level: 1 })).toHaveTextContent(/^Welcome to Featherbase$/)

  await userEvent.click(within(welcome).getByRole('link', { name: 'Explore Featherbase' }))
  expect(await screen.findByTestId('all-tables-link')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('welcome-setup')).not.toBeInTheDocument())
  expect(screen.queryByTestId('health-banner')).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('link', { name: 'Welcome' }))
  const again = await screen.findByTestId('welcome-setup')
  await userEvent.click(within(again).getByRole('link', { name: 'Set up administrators' }))
  const setup = await screen.findByTestId('first-run-setup')
  expect(screen.queryByTestId('setup-banner')).not.toBeInTheDocument()
  await userEvent.click(within(setup).getByRole('button', { name: 'Not now' }))
  expect(await screen.findByTestId('setup-banner')).toBeInTheDocument()
  expect(screen.queryByTestId('first-run-setup')).not.toBeInTheDocument()
  expect(screen.queryByTestId('health-banner')).not.toBeInTheDocument()
})

test('the old setup address, signed out, reaches the setup screen at its new address through sign-in', async () => {
  await freshInstance()
  const { router } = await renderApp('/featherbase/admin/setup/people', anonymous)
  await waitFor(() => expect(pathOf(router)).toBe('/featherbase/login'))
  await signInAsAdministrator()
  expect(await screen.findByTestId('first-run-setup', {}, { timeout: 8000 })).toBeInTheDocument()
  await waitFor(() => expect(pathOf(router)).toBe(SETUP))
})

test('once a System Manager has an address, signing in goes straight to the Admin', async ({ createUser }) => {
  await freshInstance()
  await createUser({ email: 'keeper@example.com', roles: ['System Manager'] })
  // The setup decision is made once the checks answer: wait for that answer.
  let answered = 0
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const res = await real(input, init)
    if (url.includes('/api/instance-health')) answered += 1
    return res
  })
  await renderApp('/featherbase/login', anonymous)
  await signInAsAdministrator()
  expect(await screen.findByTestId('import-data-link', {}, { timeout: 8000 })).toBeInTheDocument()
  await waitFor(() => expect(answered).toBeGreaterThan(0))
  await waitFor(() => expect(screen.getByTestId('welcome-link')).toBeInTheDocument())
  expect(screen.queryByTestId('welcome-setup')).not.toBeInTheDocument()
  expect(screen.queryByTestId('first-run-setup')).not.toBeInTheDocument()
  expect(screen.queryByTestId('setup-banner')).not.toBeInTheDocument()
})
