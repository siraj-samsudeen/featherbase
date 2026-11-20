// agent-sign-in's scenarios (#1207, mcp-oauth-connect): an agent given only
// the instance's agent address signs in through the person's browser with
// the standard MCP authorization (OAuth 2.1: metadata, registration, PKCE,
// rotating renewal keys), driven by the MCP SDK's own OAuth client against the
// real app. Each test is one fenced scenario of the agent-sign-in spec, step
// by step. Time passing is the connection's timestamps moved back in the
// test's own transaction. The pages themselves get their own tests in web.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from '../pg-test'
import { expectStatus, grantRole, makeTable, tableRef } from '../fixtures'
import { scenarioFor } from '../scenario'
import { postMcp } from '../agent-driver'
import { OAuthAgent, connectByAddress, renewWith, type BrowserVisit } from '../agent-oauth-driver'
import { sql } from '../../src/db'
import { setPasswordFromShell } from '../../src/auth'

const scenario = scenarioFor(test, 'agent-sign-in')

const CUSTOMER = tableRef('Customer')
const CLERK = 'Customer Clerk'
const AGENT = 'Claude Code'

/** "Customer" holding "Acme Traders", and "Payroll"; the clerk role reads customers and never Payroll. */
async function setUp(admin: TestClient) {
  await makeTable(admin, { name: 'Customer', module: 'Custom', columns: [{ column_name: 'customer_name', column_type: 'Data', reqd: true }, 'city'] })
  await makeTable(admin, { name: 'Payroll', module: 'Custom', columns: ['employee', 'amount:Currency'] })
  await grantRole(admin, { role: CLERK, table: 'Customer', can_read: true })
  await admin.post(CUSTOMER.url, { customer_name: 'Acme Traders', city: 'Chennai' })
}

type CreateUser = (opts?: { roles?: string[] }) => Promise<TestClient>
const clerk = (createUser: CreateUser) => createUser({ roles: [CLERK] })

/** The agent found "Acme Traders". */
function expectFound(found: Awaited<ReturnType<OAuthAgent['findCustomer']>>) {
  expect(found).toEqual({ rows: [expect.objectContaining({ customer_name: 'Acme Traders' })] })
}

/** The agent was turned away, and is waiting for the person to sign it in again. */
function expectRefusedAndAskingAgain(agent: OAuthAgent, found: Awaited<ReturnType<OAuthAgent['findCustomer']>>) {
  expect(found).not.toHaveProperty('rows')
  expect(agent.pendingAuthorization).toBeDefined()
}

/** The person's connections, as their Connected Apps page lists them. */
type Connection = { id: string; client_name: string; return_place: string; created_at: string; last_used_at: string }
const connections = async (user: TestClient) => (await user.get<{ connections: Connection[] }>('/api/agent-connections')).connections

/** Moves a person's connections, their renewal keys and short keys back by `interval` (a Postgres interval). */
async function agesBy(person: string, interval: string) {
  await sql`update agent_connection set created_at = created_at - ${interval}::interval, last_used_at = last_used_at - ${interval}::interval where person = ${person}`
  await sql`update agent_refresh_token set created_at = created_at - ${interval}::interval, used_at = used_at - ${interval}::interval
    where connection_id in (select id from agent_connection where person = ${person})`
  await sql`update access_token set created_at = created_at - ${interval}::interval, expires_at = expires_at - ${interval}::interval
    where agent_connection in (select id from agent_connection where person = ${person})`
}

describe('agent-sign-in', () => {
  scenario('The agent works as the user after signing in', async ({ admin, createUser }, step) => {
    let user!: TestClient
    const agent = new OAuthAgent({ clientName: AGENT })
    await step('the user can read customers but not "Payroll"', async () => {
      await setUp(admin)
      user = await clerk(createUser)
    })
    await step('the user gives an agent "Claude Code" the instance\'s agent address', async () => {
      expect(await agent.start()).toBe(false)
      expect(agent.pendingAuthorization).toBeDefined()
    })
    await step('signs in and allows it', async () => {
      const visit = await agent.browse(user, 'allow')
      expect(visit).toMatchObject({ status: 200, asked: true, consent: { client_name: AGENT, remembered: false } })
      expect(agent.connected).toBe(true)
    })
    await step('the agent finds the customer "Acme Traders"', async () => expectFound(await agent.findCustomer('Acme Traders')))
    await step('the agent is refused "Payroll"', async () => {
      const result = await agent.call('query_rows', { table: 'Payroll' })
      expect(result.isError).toBe(true)
    })
  })

  scenario('A signed-out user signs in on the way', async ({ admin, createUser }, step) => {
    let user!: TestClient
    const agent = new OAuthAgent({ clientName: AGENT })
    await step('the user is signed out in their browser', async () => {
      await setUp(admin)
      user = await clerk(createUser)
    })
    await step('the user gives the agent "Claude Code" the instance\'s agent address', async () => {
      expect(await agent.start()).toBe(false)
    })
    let signedOut!: BrowserVisit
    await step('the browser asks them to sign in first', async () => {
      // The page sends a signed-out browser to the usual sign-in (?next=): the
      // server's part is refusing the request without a session.
      signedOut = await agent.browse(null, 'look')
      expect(signedOut.status).toBe(401)
      expect(signedOut.consent).toBeUndefined()
    })
    await step('after they sign in it asks them to allow "Claude Code"', async () => {
      const visit = await agent.browse(user, 'look')
      expect(visit).toMatchObject({ status: 200, asked: true, consent: { client_name: AGENT, remembered: false } })
      expect(agent.connected).toBe(false)
    })
  })

  scenario('A denied agent is not connected', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const user = await clerk(createUser)
    const agent = new OAuthAgent({ clientName: AGENT })
    await step('the user gives the agent "Claude Code" the instance\'s agent address', async () => {
      expect(await agent.start()).toBe(false)
    })
    let visit!: BrowserVisit
    await step('denies it', async () => {
      visit = await agent.browse(user, 'deny')
    })
    await step('the agent is not connected and reaches no Table', async () => {
      expect(visit.redirect?.searchParams.get('error')).toBe('access_denied')
      expect(visit.redirect?.searchParams.get('code')).toBeNull()
      expect(agent.connected).toBe(false)
      expect(agent.provider.tokens()).toBeUndefined()
      expect(await connections(user)).toEqual([])
      const response = await postMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tables', arguments: {} } })
      await expectStatus(response, 401)
      expect(JSON.stringify(await response.json())).not.toContain('Customer')
    })
  })

  scenario('Connecting the same agent again does not ask', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const user = await clerk(createUser)
    await step('the user has allowed "Claude Code" on their computer', () => connectByAddress(user, { clientName: AGENT }))
    // A reinstalled client: a new registration, returning to a new local port.
    const again = new OAuthAgent({ clientName: AGENT })
    let visit!: BrowserVisit
    await step('they connect "Claude Code" again from their computer', async () => {
      expect(await again.start()).toBe(false)
      visit = await again.browse(user, 'look')
    })
    await step('it connects without asking', async () => {
      expect(visit).toMatchObject({ status: 200, asked: false, consent: { client_name: AGENT, remembered: true } })
      expect(again.connected).toBe(true)
      expectFound(await again.findCustomer('Acme Traders'))
    })
  })

  scenario('An agent returning somewhere new is asked about', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const user = await clerk(createUser)
    await step('the user has allowed "Claude Code" on their computer', () => connectByAddress(user, { clientName: AGENT }))
    const lookalike = new OAuthAgent({ clientName: AGENT, redirectUrl: 'https://claude-code.example/callback' })
    let visit!: BrowserVisit
    await step('an agent calling itself "Claude Code" asks to return to a website', async () => {
      expect(await lookalike.start()).toBe(false)
      visit = await lookalike.browse(user, 'look')
    })
    await step('the user is asked whether to allow it', () => {
      expect(visit).toMatchObject({
        status: 200, asked: true,
        consent: { client_name: AGENT, return_place: 'https://claude-code.example', remembered: false },
      })
      expect(lookalike.connected).toBe(false)
    })
  })

  scenario('The agent still works the next day', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const user = await clerk(createUser)
    let agent!: OAuthAgent
    await step('the user connected "Claude Code" yesterday', async () => {
      agent = await connectByAddress(user, { clientName: AGENT })
      await agesBy(user.user!, '1 day')
    })
    let found!: Awaited<ReturnType<OAuthAgent['findCustomer']>>
    const visitsBefore = agent.visits.length
    await step('the agent looks for "Acme Traders" today', async () => {
      found = await agent.findCustomer('Acme Traders')
    })
    await step('it finds it without asking the user anything', () => {
      expectFound(found)
      expect(agent.pendingAuthorization).toBeUndefined()
      expect(agent.visits).toHaveLength(visitsBefore)
    })
  })

  scenario('An agent unused for a month is disconnected', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const user = await clerk(createUser)
    let agent!: OAuthAgent
    await step('the user connected "Claude Code" and has not used it for 31 days', async () => {
      agent = await connectByAddress(user, { clientName: AGENT })
      await agesBy(user.user!, '31 days')
    })
    let found!: Awaited<ReturnType<OAuthAgent['findCustomer']>>
    await step('the agent looks for "Acme Traders"', async () => {
      found = await agent.findCustomer('Acme Traders')
    })
    await step('it is refused and must be connected again', async () => {
      expectRefusedAndAskingAgain(agent, found)
      expect(await connections(user)).toEqual([])
    })
  })

  scenario('A disconnected agent is refused', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const user = await clerk(createUser)
    let agent!: OAuthAgent
    await step('the user has connected "Claude Code"', async () => {
      agent = await connectByAddress(user, { clientName: AGENT })
    })
    await step('the user disconnects "Claude Code"', async () => {
      const listed = await connections(user)
      expect(listed).toEqual([expect.objectContaining({ client_name: AGENT, return_place: 'loopback' })])
      await user.delete(`/api/agent-connections/${encodeURIComponent(listed[0]!.id)}`)
    })
    await step('the agent is refused when it looks for "Acme Traders"', async () => {
      expectRefusedAndAskingAgain(agent, await agent.findCustomer('Acme Traders'))
    })
  })

  scenario('A password reset disconnects the agent', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const user = await clerk(createUser)
    let agent!: OAuthAgent
    await step('the user has connected "Claude Code"', async () => {
      agent = await connectByAddress(user, { clientName: AGENT })
    })
    await step('the user\'s password is reset', () => setPasswordFromShell(user.user!, 'reset-by-operator-1'))
    await step('the agent is refused when it looks for "Acme Traders"', async () => {
      expectRefusedAndAskingAgain(agent, await agent.findCustomer('Acme Traders'))
    })
  })

  scenario('A copied renewal key ends the connection', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const user = await clerk(createUser)
    let agent!: OAuthAgent
    await step('the user has connected "Claude Code"', async () => {
      agent = await connectByAddress(user, { clientName: AGENT })
    })
    let copied = ''
    await step('someone copied the key it renews itself with', () => {
      copied = agent.refreshToken!
      expect(copied).toBeTruthy()
    })
    let copy!: Response
    await step('the agent and the copy have both renewed with it, minutes apart', async () => {
      // The agent's short key runs out, so its next call renews with the key.
      await sql`update access_token set expires_at = now() - interval '1 minute'
        where agent_connection in (select id from agent_connection where person = ${user.user!})`
      expectFound(await agent.findCustomer('Acme Traders'))
      expect(agent.refreshToken).not.toBe(copied)
      // Five minutes later, past the two-minute grace, the copy renews with the same key.
      await sql`update agent_refresh_token set used_at = used_at - interval '5 minutes'
        where connection_id in (select id from agent_connection where person = ${user.user!})`
      copy = await renewWith(agent.tokenEndpoint!, agent.provider.clientInformation()!.client_id, copied)
    })
    await step('the connection ends and neither can look for "Acme Traders"', async () => {
      expect(copy.status).toBe(400)
      const answer = (await copy.json()) as Record<string, unknown>
      expect(answer).toMatchObject({ error: 'invalid_grant' })
      expect(answer).not.toHaveProperty('access_token')
      expectRefusedAndAskingAgain(agent, await agent.findCustomer('Acme Traders'))
      expect(await connections(user)).toEqual([])
    })
  })
})
