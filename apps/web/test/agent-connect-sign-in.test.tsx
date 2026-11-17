// mcp-oauth-connect (#1207, item 4): a signed-out browser opening the connect
// page goes through the usual sign-in and comes back to the page with the
// agent's whole request, whichever way the person signs in.
import { afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { _setDelegatedFetch } from 'server/src/delegated-login'
import { configureDelegated, linkDelegated } from 'server/test/identity-fixtures'
import { OAuthAgent } from 'server/test/agent-oauth-driver'
import { test, expect, renderApp } from './pg-test'
import { takeLoginNext } from '../src/pages/Login'

const anonymous = { user: null, token: null } as never
const WAIT = { timeout: 10_000 }

type Router = { state: { location: { pathname: string; searchStr: string } } }
const where = (r: unknown) => (r as Router).state.location

/** The connect page's address and the agent's request, as the agent sends the browser there. */
async function connectAddress() {
  const agent = new OAuthAgent({ clientName: 'Claude Code' })
  await agent.start()
  const authorize = agent.pendingAuthorization!
  return { request: Object.fromEntries(authorize.searchParams), path: `/featherbase/connect${authorize.search}` }
}

/** The agent's request a page address carries, as name/value pairs. */
const requestIn = (address: string) => Object.fromEntries(new URL(address, 'http://localhost').searchParams)

afterEach(() => {
  _setDelegatedFetch(null)
  vi.unstubAllEnvs()
})

test('signed out, the connect page sends the person to sign in with the whole request as next', async () => {
  const { request, path } = await connectAddress()
  const { router } = await renderApp(path, anonymous)
  await waitFor(() => expect(where(router).pathname).toBe('/featherbase/login'), WAIT)
  const next = new URLSearchParams(where(router).searchStr).get('next')!
  expect(new URL(next, 'http://localhost').pathname).toBe('/featherbase/connect')
  expect(requestIn(next)).toEqual(request)
})

test('a password sign-in comes back to the connect page with the request', async ({ admin, createUser }) => {
  const person = await createUser({ email: 'connect.password@example.com', fullName: 'Password Person' })
  await admin.post('/api/set_password', { user: person.user, password: 'connect-pw-1' })
  const { request, path } = await connectAddress()
  const { router } = await renderApp(path, anonymous)
  await userEvent.type(await screen.findByLabelText('Email or username', {}, WAIT), 'connect.password@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'connect-pw-1')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByTestId('connect-consent', {}, WAIT)).toHaveTextContent('Signed in as Password Person')
  expect(where(router).pathname).toBe('/featherbase/connect')
  expect(requestIn(`?${where(router).searchStr.replace(/^\?/, '')}`)).toEqual(request)
})

test('a StyleHR sign-in comes back to the connect page with the request', async ({ createUser }) => {
  await configureDelegated()
  const person = await createUser({ email: 'connect.stylehr@example.com', fullName: 'StyleHR Person' })
  await linkDelegated(person.user!, 'connect_hr_1')
  _setDelegatedFetch((async () => Response.json({ ok: true })) as typeof fetch)
  const { path } = await connectAddress()
  await renderApp(path, anonymous)
  await screen.findByTestId('delegated-login-form', {}, WAIT)
  await userEvent.type(screen.getByLabelText('StyleHR ID'), 'connect_hr_1')
  await userEvent.type(screen.getByLabelText('Password'), 'hr-password')
  await userEvent.click(screen.getByTestId('delegated-login-submit'))
  expect(await screen.findByTestId('connect-consent', {}, WAIT)).toHaveTextContent('Signed in as StyleHR Person')
})

test('the Google button keeps the connect page and its request for the way back', async () => {
  vi.stubEnv('ALLOW_MOCK_OAUTH', '1')
  const { request, path } = await connectAddress()
  await renderApp(path, anonymous)
  const google = await screen.findByTestId('google-login', {}, WAIT)
  google.addEventListener('click', (e) => e.preventDefault()) // jsdom cannot leave for Google
  await userEvent.click(google)
  const back = takeLoginNext()!
  expect(new URL(back, 'http://localhost').pathname).toBe('/featherbase/connect')
  expect(requestIn(back)).toEqual(request)
})
