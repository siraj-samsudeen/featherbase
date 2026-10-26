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
