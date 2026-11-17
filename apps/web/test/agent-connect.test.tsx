// mcp-oauth-connect (#1207, items 4-7): the page an agent opens in the
// person's browser to connect. The agent is the MCP SDK's own OAuth client
// (server/test/agent-oauth-driver), so the page gets the very authorize query a
// real agent sends; the page's fetches reach the real in-process server. Only
// the browser's navigation is stood in for: jsdom cannot leave the page.
import { afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OAuthAgent, connectByAddress } from 'server/test/agent-oauth-driver'
import { test, expect, renderApp } from './pg-test'
import { browserNavigation } from '../src/lib/browser-navigation'

const WAIT = { timeout: 10_000 }

/** The connect page's address, as the agent sends the browser there. */
async function connectAddress(clientName = 'Claude Code') {
  const agent = new OAuthAgent({ clientName })
  expect(await agent.start()).toBe(false)
  const authorize = agent.pendingAuthorization!
  return { agent, authorize, path: `/featherbase/connect${authorize.search}` }
}

function stubNavigation() {
  return vi.spyOn(browserNavigation, 'leaveFor').mockImplementation(() => {})
}

afterEach(() => vi.restoreAllMocks())

test('the consent card names the client, where it returns and who is signed in', async ({ createUser }) => {
  const person = await createUser({ email: 'consent.facts@example.com', fullName: 'Consent Person' })
  const { path } = await connectAddress('Claude Code')
  await renderApp(path, person)
  const card = await screen.findByTestId('connect-consent', {}, WAIT)
  expect(card).toHaveTextContent('“Claude Code” wants to connect')
  expect(card).toHaveTextContent('It will return to your computer')
  expect(card).toHaveTextContent('Signed in as Consent Person')
  expect(card).toHaveTextContent('It will act as you, with your roles and permissions, until you disconnect it.')
  expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument()
})

test('Allow sends the browser back to the agent with a code', async ({ createUser }) => {
  const person = await createUser({ email: 'consent.allow@example.com' })
  const { authorize, path } = await connectAddress()
  const assign = stubNavigation()
  await renderApp(path, person)
  await userEvent.click(await screen.findByRole('button', { name: 'Allow' }, WAIT))
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(1), WAIT)
  const back = new URL(String(assign.mock.calls[0][0]))
  expect(`${back.origin}${back.pathname}`).toBe(authorize.searchParams.get('redirect_uri'))
  expect(back.searchParams.get('code')).toBeTruthy()
  expect(back.searchParams.get('state')).toBe(authorize.searchParams.get('state'))
  expect(await screen.findByTestId('connect-sent')).toHaveTextContent('You can close this window.')
})

test('Deny sends the browser back to the agent with access_denied', async ({ createUser }) => {
  const person = await createUser({ email: 'consent.deny@example.com' })
  const { authorize, path } = await connectAddress()
  const assign = stubNavigation()
  await renderApp(path, person)
  await userEvent.click(await screen.findByRole('button', { name: 'Deny' }, WAIT))
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(1), WAIT)
  const back = new URL(String(assign.mock.calls[0][0]))
  expect(back.searchParams.get('error')).toBe('access_denied')
  expect(back.searchParams.get('code')).toBeNull()
  expect(back.searchParams.get('state')).toBe(authorize.searchParams.get('state'))
  expect(await screen.findByTestId('connect-sent')).toHaveTextContent('You can close this window.')
})

test('an agent already allowed goes straight back without asking', async ({ createUser }) => {
  const person = await createUser({ email: 'consent.remembered@example.com' })
  await connectByAddress(person, { clientName: 'Claude Code' })
  const { path } = await connectAddress('Claude Code')
  const assign = stubNavigation()
  await renderApp(path, person)
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(1), WAIT)
  expect(new URL(String(assign.mock.calls[0][0])).searchParams.get('code')).toBeTruthy()
  expect(screen.queryByTestId('connect-consent')).not.toBeInTheDocument()
  expect(await screen.findByTestId('connect-sent')).toHaveTextContent('You can close this window.')
})

test('while it goes back, the page says it is connecting the agent', async ({ createUser }) => {
  const person = await createUser({ email: 'consent.connecting@example.com' })
  await connectByAddress(person, { clientName: 'Claude Code' })
  const { path } = await connectAddress('Claude Code')
  const assign = stubNavigation()
  await renderApp(path, person)
  expect(await screen.findByTestId('connect-remembered', {}, WAIT)).toHaveTextContent('Connecting “Claude Code”…')
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(1), WAIT)
})

test('a request the server refuses shows its message and goes nowhere', async ({ createUser }) => {
  const person = await createUser({ email: 'consent.refused@example.com' })
  const { authorize } = await connectAddress()
  const bad = new URLSearchParams(authorize.search)
  bad.set('client_id', 'cli_nobody')
  const assign = stubNavigation()
  await renderApp(`/featherbase/connect?${bad}`, person)
  const error = await screen.findByTestId('connect-error', {}, WAIT)
  // The server's own words.
  expect(error).toHaveTextContent('This agent is not registered here. Start connecting it again from the agent.')
  expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
  expect(assign).not.toHaveBeenCalled()
})

test('leaving for the agent\'s address is a full page load', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  browserNavigation.leaveFor('http://127.0.0.1:52999/callback?code=x')
  // jsdom cannot load another document; it reports the attempt instead.
  expect(errors.mock.calls.some((c) => /Not implemented: navigation/.test(String((c[0] as Error)?.message ?? c[0])))).toBe(true)
})
