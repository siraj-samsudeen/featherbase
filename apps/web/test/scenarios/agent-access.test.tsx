// agent-access's scenarios a person reads on screen (#1101). Each test is one
// fenced scenario of openspec/specs/agent-access/spec.md, step by step,
// rendered in jsdom against the real in-process server, the agent driven by
// the MCP SDK's own client; the rest are in apps/server/test/scenarios/.
process.env.TZ = 'Asia/Kolkata'

import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { scenarioFor } from 'server/test/scenario'
import { grantRole, makeTable, tableRef } from 'server/test/fixtures'
import { connectAgent, issueToken, type Agent } from 'server/test/agent-driver'
import { test, expect, renderSession } from '../pg-test'

const scenario = scenarioFor(test, 'agent-access')

const CUSTOMER = tableRef('Customer')
const CLERK = 'Customer Clerk'
type Row = { row_id: string; updated_at: string }

describe('agent-access', () => {
  scenario('A change through an agent is marked', async ({ admin, createUser }, step) => {
    let user!: TestClient
    let agent!: Agent
    let id = ''
    await step('the user has connected an agent with their access token labelled "Claude on my laptop"', async () => {
      await makeTable(admin, { name: 'Customer', module: 'Custom', track_changes: true, columns: ['customer_name', 'city'] })
      await grantRole(admin, { role: CLERK, table: 'Customer', can_read: true, can_write: true, can_create: true })
      id = (await admin.post<Row>(CUSTOMER.url, { customer_name: 'Acme Traders', city: 'Chennai' })).row_id
      user = await createUser({ fullName: 'Meena Iyer', roles: [CLERK] })
      agent = await connectAgent(await issueToken(user, 'Claude on my laptop'))
    })
    await step('the agent changes the city of "Acme Traders" to "Madurai"', async () => {
      const { updated_at } = await agent.ok<Row>('get_row', { table: 'Customer', id })
      await agent.ok('update_row', { table: 'Customer', id, values: { city: 'Madurai' }, updated_at })
    })
    let change!: HTMLElement
    await step('the change in its history is by the user', async () => {
      // Read by an administrator: a clerk may not read the Person directory, so
      // the Admin names the clerk "Unnamed person" to themselves (a finding of #1101).
      const { session } = await renderSession(`/featherbase/admin/table/${tableSlug('Customer')}/row/${id}`, admin)
      await session.click('Activity')
      const timeline = await screen.findByTestId('activity-timeline', {}, { timeout: 10_000 })
      await waitFor(() => {
        change = within(timeline).getAllByTestId('activity-version').find((e) => e.textContent?.includes('Chennai → Madurai'))!
        expect(within(change).getByTestId('principal-name')).toHaveTextContent('Meena Iyer')
      })
    })
    await step('the history reads "edited via Claude on my laptop" after the user\'s name', () =>
      expect(change).toHaveTextContent(/^Meena Iyer edited via Claude on my laptop · /))
  })
})
