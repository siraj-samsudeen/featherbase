// mcp-oauth-connect (#1207, items 10-11): Connected apps, the person's own
// account page listing the agents they connected, with Disconnect. The agents
// connect for real through the MCP SDK's OAuth client
// (server/test/agent-oauth-driver), against the in-process server.
import { afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { connectByAddress } from 'server/test/agent-oauth-driver'
import { test, expect, renderApp } from './pg-test'

const WAIT = { timeout: 10_000 }
const PAGE = '/featherbase/account/connected-apps'

afterEach(() => vi.restoreAllMocks())

const rows = () => screen.queryAllByTestId(/^connection-con_/)

test('each live connection shows its name and where it returns to', async ({ createUser }) => {
  const person = await createUser({ email: 'apps.list@example.com' })
  await connectByAddress(person, { clientName: 'Claude Code' })
  await connectByAddress(person, { clientName: 'Claude', redirectUrl: 'https://claude.ai/api/mcp/auth_callback' })
  await renderApp(PAGE, person)
  await waitFor(() => expect(rows()).toHaveLength(2), WAIT)
  // Made in one transaction, they share a timestamp: found by name, not order.
  const named = (name: string) => rows().find((r) => r.textContent!.startsWith(`“${name}”`))!
  const web = named('Claude')
  const local = named('Claude Code')
  expect(web).toHaveTextContent('Returns to https://claude.ai')
  expect(local).toHaveTextContent('Returns to your computer')
})

test('a connection says when it was connected and when it was last used', async ({ createUser }) => {
  const person = await createUser({ email: 'apps.times@example.com' })
  await connectByAddress(person)
  const [fresh] = await sql`select created_at from agent_connection where person = ${person.user}`
  const day = new Date(fresh.created_at as Date)
  const connected = `${String(day.getDate()).padStart(2, '0')}-${day.toLocaleString('en', { month: 'short' })}-${day.getFullYear()}`
  await renderApp(PAGE, person)
  await waitFor(() => expect(rows()).toHaveLength(1), WAIT)
  expect(rows()[0]).toHaveTextContent(`Connected ${connected}`)
  expect(rows()[0]).toHaveTextContent('Last used just now')
})

test('a connection last used hours ago says so', async ({ createUser }) => {
  const person = await createUser({ email: 'apps.hours@example.com' })
  await connectByAddress(person)
  await sql`update agent_connection set last_used_at = now() - interval '3 hours' where person = ${person.user}`
  await renderApp(PAGE, person)
  await waitFor(() => expect(rows()).toHaveLength(1), WAIT)
  expect(rows()[0]).toHaveTextContent('Last used 3 hours ago')
})

test('Disconnect, once confirmed, ends the connection', async ({ createUser }) => {
  const person = await createUser({ email: 'apps.disconnect@example.com' })
  await connectByAddress(person, { clientName: 'Claude Code' })
  await renderApp(PAGE, person)
  await waitFor(() => expect(rows()).toHaveLength(1), WAIT)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await userEvent.click(within(rows()[0]).getByRole('button', { name: 'Disconnect' }))
  expect(confirm).toHaveBeenCalledWith('Disconnect “Claude Code”? It will stop working until you connect it again.')
  await waitFor(() => expect(rows()).toHaveLength(0), WAIT)
  expect(await person.get('/api/agent-connections')).toEqual({ connections: [] })
})

test('declining the confirmation keeps the connection', async ({ createUser }) => {
  const person = await createUser({ email: 'apps.keep@example.com' })
  await connectByAddress(person)
  await renderApp(PAGE, person)
  await waitFor(() => expect(rows()).toHaveLength(1), WAIT)
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  await userEvent.click(within(rows()[0]).getByRole('button', { name: 'Disconnect' }))
  expect(rows()).toHaveLength(1)
  expect((await person.get<{ connections: unknown[] }>('/api/agent-connections')).connections).toHaveLength(1)
})

test('with nothing connected, the page says how to connect an agent', async ({ createUser }) => {
  const person = await createUser({ email: 'apps.empty@example.com' })
  await renderApp(PAGE, person)
  const empty = await screen.findByTestId('connected-apps-empty', {}, WAIT)
  expect(empty).toHaveTextContent('No agents connected.')
  expect(empty).toHaveTextContent(`To connect one, give your agent this address: ${window.location.origin}/mcp`)
})

test('the agent address copies with one click', async ({ createUser }) => {
  const person = await createUser({ email: 'apps.copy@example.com' })
  const user = userEvent.setup() // also stands in for the clipboard
  await renderApp(PAGE, person)
  await user.click(await screen.findByRole('button', { name: 'Copy' }, WAIT))
  expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/mcp`)
  expect(screen.getByRole('button', { name: 'Copied ✓' })).toBeInTheDocument()
})

test('when the browser refuses to copy, the page says to copy the address by hand', async ({ createUser }) => {
  const person = await createUser({ email: 'apps.copy.refused@example.com' })
  const user = userEvent.setup()
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'))
  await renderApp(PAGE, person)
  await user.click(await screen.findByRole('button', { name: 'Copy' }, WAIT))
  expect(await screen.findByTestId('copy-address-refused')).toHaveTextContent('Copying was blocked. Select the address and copy it yourself.')
})
