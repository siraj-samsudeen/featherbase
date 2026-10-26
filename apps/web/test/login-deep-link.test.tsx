// Home cleanup: a signed-out deep link survives the sign-in. The route guard
// carries the destination as a safe same-origin `next`; a password sign-in
// returns there, and the Google round trip carries it across the redirect.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { rememberLoginNext, takeLoginNext } from '../src/pages/Login'

const anonymous = { user: null, token: null } as never
const DEEP = '/featherbase/admin/Sign%20In%20Method/google'

type Router = { state: { location: { pathname: string; searchStr: string; href: string } } }
const where = (r: unknown) => (r as Router).state.location

test('a signed-out deep link sends the person to sign in with the link as next', async () => {
  const { router } = await renderApp(DEEP, anonymous)
  await waitFor(() => expect(where(router).pathname).toBe('/featherbase/login'))
  expect(new URLSearchParams(where(router).searchStr).get('next')).toBe(DEEP)
})

test('signing in with a password from that link lands on the link, not on Home', async ({ admin, createUser }) => {
  const person = await createUser({ email: 'deep.link@example.com', roles: ['System Manager'] })
  await admin.post('/api/set_password', { user: person.user, password: 'deep-link-pw-1' })
  const { router } = await renderApp(DEEP, anonymous)
  await userEvent.type(await screen.findByLabelText('Email or username'), 'deep.link@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'deep-link-pw-1')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(where(router).href).toBe(DEEP))
})

test('the Google button remembers the destination for the OAuth round trip', async () => {
  vi.stubEnv('ALLOW_MOCK_OAUTH', '1')
  await renderApp(`/featherbase/login?next=${encodeURIComponent(DEEP)}`, anonymous)
  const google = await screen.findByTestId('google-login')
  google.addEventListener('click', (e) => e.preventDefault()) // jsdom cannot leave the page
  await userEvent.click(google)
  expect(takeLoginNext()).toBe(DEEP)
  expect(takeLoginNext()).toBeUndefined() // one use
})

test('only a safe same-origin destination is remembered', () => {
  rememberLoginNext('https://attacker.example/featherbase/admin')
  expect(takeLoginNext()).toBeUndefined()
  rememberLoginNext('/featherbase/login')
  expect(takeLoginNext()).toBeUndefined()
  rememberLoginNext(DEEP)
  expect(takeLoginNext()).toBe(DEEP)
})

// Siraj, 26-Oct (#476): a refused Google sign-in comes back as
// `/login?error=…` with no `next`. The saved destination must survive it — in
// the address bar too — so a password or StyleHR sign-in afterwards lands
// there, and clearing `error` once the person chooses keeps `next`.
test('after a Google refusal, a password sign-in still lands on the saved deep link', async ({ admin, createUser }) => {
  vi.stubEnv('ALLOW_MOCK_OAUTH', '1')
  const person = await createUser({ email: 'refused.then.password@example.com', roles: ['System Manager'] })
  await admin.post('/api/set_password', { user: person.user, password: 'refusal-pw-1' })
  rememberLoginNext(DEEP)
  window.history.replaceState(null, '', '/featherbase/login?error=not_provisioned')
  const { router } = await renderApp('/featherbase/login?error=not_provisioned', anonymous)
  await screen.findByTestId('sign-in-refused-panel')
  // The destination is back in the address bar, beside the refusal.
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('next')).toBe(DEEP))
  await userEvent.click(screen.getByTestId('refused-other-ways'))
  // Choosing clears `error` and keeps `next`.
  expect(new URLSearchParams(window.location.search).get('error')).toBeNull()
  expect(new URLSearchParams(window.location.search).get('next')).toBe(DEEP)
  await userEvent.type(await screen.findByLabelText('Email or username'), 'refused.then.password@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'refusal-pw-1')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(where(router).href).toBe(DEEP))
  // Used once: nothing is left to send a later sign-in somewhere stale.
  expect(takeLoginNext()).toBeUndefined()
  window.history.replaceState(null, '', '/')
})
