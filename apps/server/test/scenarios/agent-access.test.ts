// agent-access's scenarios (#1083): an agent connected to /mcp with an access
// token, driven by the MCP SDK's own client against the real app. Each test
// is one fenced scenario of the agent-access spec, step by step. "A change
// through an agent is marked" reads on screen: apps/web/test/scenarios/.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { patchDoc, test } from '../pg-test'
import { grantRole, makeTable, tableRef } from '../fixtures'
import { scenarioFor } from '../scenario'
import { connectAgent, issueToken, postMcp, type Agent } from '../agent-driver'
import { saveDoc } from '../../src/document'

const scenario = scenarioFor(test, 'agent-access')

const CUSTOMER = tableRef('Customer')
const CLERK = 'Customer Clerk'

type Row = Record<string, unknown> & { row_id: string }
type Activity = { created: { created_by: string; author_name: string }; versions: Version[] }
type Version = { created_by: string; author_name: string; data: { created?: boolean; changed: [string, unknown, unknown][]; agent?: { token_id: string; token_label: string } } }

/** "Customer" (a required name, a Retail/Wholesale type, a city, contacts, a
 *  sensitive credit limit, history kept) and "Payroll"; the clerk role reads,
 *  adds and changes customers but deletes none and never sees Payroll. */
async function setUp(admin: TestClient, seed = true) {
  await makeTable(admin, { name: 'Customer Contact', module: 'Custom', kind: 'sub_table', columns: ['contact_name', 'phone'] })
  await makeTable(admin, {
    name: 'Customer', module: 'Custom', track_changes: true,
    columns: [
      { column_name: 'customer_name', column_type: 'Data', reqd: true },
      { column_name: 'customer_type', column_type: 'Choice', choices: 'Retail\nWholesale' },
      'city',
      { column_name: 'contacts', column_type: 'Sub-table', row_table: 'Customer Contact' },
      { column_name: 'credit_limit', column_type: 'Currency', tier: 'restricted' },
    ],
  })
  await makeTable(admin, { name: 'Payroll', module: 'Custom', columns: ['employee', 'amount:Currency'] })
  await grantRole(admin, { role: CLERK, table: ['Customer', 'Customer Contact'], can_read: true, can_write: true, can_create: true })
  const ids: Record<string, string> = {}
  if (seed)
    for (const [name, city] of [['Acme Traders', 'Chennai'], ['Bala Stores', 'Chennai'], ['Coral Mart', 'Madurai']]) {
      const row = await admin.post<Row>(CUSTOMER.url, {
        customer_name: name, customer_type: 'Retail', city, credit_limit: 50000,
        contacts: name === 'Acme Traders' ? [{ contact_name: 'Anand', phone: '044 2000 0000' }] : [],
      })
      ids[name] = row.row_id
    }
  return ids
}

async function clerkAgent(admin: TestClient, createUser: (opts?: { roles?: string[] }) => Promise<TestClient>, label = 'my agent') {
  const user = await createUser({ roles: [CLERK] })
  const agent = await connectAgent(await issueToken(user, label))
  return { user, agent }
}

const activity = (admin: TestClient, id: string) => admin.get<Activity>(`/api/activity/Customer/${encodeURIComponent(id)}`)
const history = async (admin: TestClient, id: string) => (await activity(admin, id)).versions

/** The agent reads the row, then changes its city with the version it read. */
async function agentMoves(agent: Agent, id: string, city: string) {
  const { updated_at } = await agent.ok<Row>('get_row', { table: 'Customer', id })
  return agent.ok('update_row', { table: 'Customer', id, values: { city }, updated_at })
}

const refusalText = (result: { content: { text: string }[] }) => result.content.map((c) => c.text).join('\n')

/** #1105: an agent whose user may also build Tables (System Manager). */
async function builderAgent(createUser: (opts?: { roles?: string[] }) => Promise<TestClient>) {
  const user = await createUser({ roles: [CLERK, 'System Manager'] })
  return { user, agent: await connectAgent(await issueToken(user)) }
}

type Check = { valid: number; inserted: number; updated: number; changed: number; failed: { row: number; message: string; fields?: Record<string, string> }[]; check: string }
type ImportArgs = Record<string, unknown> & { table: string; csv: string }

/** check_import, then run_import with the check it gave. */
async function importFile(agent: Agent, args: ImportArgs, extra: Record<string, unknown> = {}) {
  const { check } = await agent.ok<Check>('check_import', args)
  return agent.ok<{ run_id: string; inserted: number; updated: number; failed: unknown[] }>('run_import', { ...args, check, ...extra })
}

const customers = async (admin: TestClient, filters: unknown[] = []) =>
  (await admin.get<{ data: Row[] }>(CUSTOMER.listUrl({ fields: ['row_id', 'customer_name', 'city', 'customer_type'], filters, limit_page_length: 500 }))).data

describe('agent-access', () => {
  scenario('The agent works as the user', async ({ admin, createUser }, step) => {
    let user!: TestClient
    let agent!: Agent
    let id = ''
    await step('the user has connected an agent with their access token', async () => {
      await setUp(admin)
      ;({ user, agent } = await clerkAgent(admin, createUser))
    })
    await step('the agent adds a customer "Dhan Agencies"', async () => {
      id = (await agent.ok<Row>('create_row', { table: 'Customer', values: { customer_name: 'Dhan Agencies', city: 'Salem' } })).row_id
    })
    await step('the customer\'s history shows the user added it', async () => {
      const { created, versions } = await activity(admin, id)
      expect(created.created_by).toBe(user.user)
      expect(versions).toEqual([expect.objectContaining({ created_by: user.user, data: expect.objectContaining({ created: true }) })])
    })
  })

  scenario('Without a token the agent is turned away', async ({ admin, client }, step) => {
    let response!: Response
    await step('the user is signed in to Featherbase in their browser', () => setUp(admin))
    await step('an agent connects without an access token', async () => {
      response = await postMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tables', arguments: {} } }, { cookie: `sid=${client.token}` })
    })
    await step('the connection is refused and no Table is reachable', async () => {
      expect(response.status).toBe(401)
      const body = await response.json() as Record<string, unknown>
      expect(body).not.toHaveProperty('result')
      expect(JSON.stringify(body)).not.toContain('Customer')
    })
  })

  scenario('A change by hand is not marked', async ({ admin, createUser }, step) => {
    const ids = await setUp(admin)
    const user = await createUser({ roles: [CLERK] })
    await step('the user changes the city of "Acme Traders" to "Madurai" themselves', async () => {
      const { updated_at } = await user.get<Row>(CUSTOMER.rowUrl(ids['Acme Traders']!))
      await patchDoc(user, CUSTOMER.rowUrl(ids['Acme Traders']!), { city: 'Madurai', updated_at })
    })
    let change!: Version
    await step('the change in its history is by the user', async () => {
      change = (await history(admin, ids['Acme Traders']!)).at(-1)!
      expect(change.created_by).toBe(user.user)
      expect(change.data.changed).toContainEqual(['city', 'Chennai', 'Madurai'])
    })
    await step('it is not marked as made through an agent', () => expect(change.data).not.toHaveProperty('agent'))
  })

  scenario('A service account\'s agent sees only what the account may read', async ({ admin }, step) => {
    let agent!: Agent
    await step('a service account "nightly-sync" that can read "Customer" but not "Payroll"', async () => {
      await setUp(admin)
      const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'nightly-sync', roles: [CLERK] })
      agent = await connectAgent(await issueToken(admin, 'Sync agent', account.row_id))
    })
    let tables: string[] = []
    await step('an agent connected with the account\'s access token asks which Tables it can work with', async () => {
      tables = (await agent.ok<{ tables: { name: string }[] }>('list_tables')).tables.map((t) => t.name)
    })
    await step('"Customer" is listed', () => expect(tables).toContain('Customer'))
    await step('"Payroll" is not', () => expect(tables).not.toContain('Payroll'))
  })

  scenario('A service account\'s change is marked', async ({ admin }, step) => {
    let agent!: Agent
    let account = ''
    await step('an agent connected with the access token "Sync agent" of the service account "nightly-sync"', async () => {
      await setUp(admin)
      account = (await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'nightly-sync', roles: [CLERK] })).row_id
      agent = await connectAgent(await issueToken(admin, 'Sync agent', account))
    })
    let id = ''
    await step('the agent adds a customer "Dhan Agencies"', async () => {
      id = (await agent.ok<Row>('create_row', { table: 'Customer', values: { customer_name: 'Dhan Agencies' } })).row_id
    })
    let entry!: Version
    await step('the customer\'s history shows "nightly-sync" added it', async () => {
      const { created, versions } = await activity(admin, id)
      expect(created).toMatchObject({ created_by: account, author_name: 'nightly-sync' })
      ;[entry] = versions
      expect(entry).toMatchObject({ created_by: account, data: { created: true } })
    })
    await step('it is marked as made through an agent with the token "Sync agent"', () =>
      expect(entry.data.agent).toMatchObject({ token_label: 'Sync agent' }))
  })

  scenario('A Table the user cannot read is not listed', async ({ admin, createUser }, step) => {
    let agent!: Agent
    await step('the user can read "Customer" but not "Payroll"', async () => {
      await setUp(admin)
      ;({ agent } = await clerkAgent(admin, createUser))
    })
    let tables: { name: string; label: string }[] = []
    await step('the agent asks which Tables it can work with', async () => {
      tables = (await agent.ok<{ tables: typeof tables }>('list_tables')).tables
    })
    await step('"Customer" is listed', () => expect(tables.map((t) => t.name)).toContain('Customer'))
    await step('"Payroll" is not', () => expect(tables.map((t) => t.name)).not.toContain('Payroll'))
  })

  type Described = { columns: { name: string; type: string; required: boolean; choices?: string[]; columns?: { name: string }[] }[] }

  scenario('The agent learns how to fill a Table', async ({ admin, createUser }, step) => {
    let agent!: Agent
    await step('"Customer" requires a name and offers the choices "Retail" and "Wholesale" for its type', async () => {
      await setUp(admin)
      ;({ agent } = await clerkAgent(admin, createUser))
    })
    let described!: Described
    await step('the agent asks what "Customer" holds', async () => {
      described = await agent.ok<Described>('describe_table', { table: 'Customer' })
    })
    await step('it learns that a name is required and that the type is "Retail" or "Wholesale"', () => {
      const column = (name: string) => described.columns.find((c) => c.name === name)
      expect(column('customer_name')).toMatchObject({ type: 'Data', required: true })
      expect(column('customer_type')).toMatchObject({ type: 'Choice', required: false, choices: ['Retail', 'Wholesale'] })
    })
  })

  scenario('A sensitive column stays unknown', async ({ admin, createUser }, step) => {
    let agent!: Agent
    await step('"Customer" has a sensitive credit limit the user may not see', async () => {
      await setUp(admin)
      ;({ agent } = await clerkAgent(admin, createUser))
    })
    let answer = ''
    await step('the agent asks what "Customer" holds', async () => {
      answer = JSON.stringify(await agent.call('describe_table', { table: 'Customer' }))
    })
    await step('the credit limit is not mentioned', () => {
      expect(answer).toContain('customer_name')
      expect(answer).not.toContain('credit_limit')
    })
  })

  type Page = { rows: Row[]; total: number; offset: number; limit: number }

  scenario('Customers in one city', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    let page!: Page
    await step('the agent asks for customers in Chennai', async () => {
      page = await agent.ok<Page>('query_rows', { table: 'Customer', filters: [['city', '=', 'Chennai']], order_by: 'customer_name asc' })
    })
    await step('it gets "Acme Traders" and "Bala Stores"', () =>
      expect(page.rows.map((r) => r.customer_name)).toEqual(['Acme Traders', 'Bala Stores']))
    await step('it is told 2 customers match', () => expect(page.total).toBe(2))
  })

  scenario('A page is capped', async ({ admin, createUser }, step) => {
    let agent!: Agent
    await step('"Customer" holds 250 customers', async () => {
      await setUp(admin, false)
      for (let i = 1; i <= 250; i++) await saveDoc('Customer', { customer_name: `Customer ${i}` }, 'Administrator', 'insert')
      ;({ agent } = await clerkAgent(admin, createUser))
    })
    let page!: Page
    await step('the agent asks for 500 customers at once', async () => {
      page = await agent.ok<Page>('query_rows', { table: 'Customer', limit: 500 })
    })
    await step('it gets 100 of them', () => expect(page.rows).toHaveLength(100))
    await step('it is told 250 match, so it can ask for the next page', () => expect(page).toMatchObject({ total: 250, offset: 0, limit: 100 }))
  }, 60_000)

  scenario('Opening a customer', async ({ admin, createUser }, step) => {
    const ids = await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    let row!: Row
    await step('the agent opens "Acme Traders"', async () => {
      row = await agent.ok<Row>('get_row', { table: 'Customer', id: ids['Acme Traders'] })
    })
    await step('it gets its city "Chennai" and its contacts', () => {
      expect(row.city).toBe('Chennai')
      expect(row.contacts).toEqual([expect.objectContaining({ contact_name: 'Anand', phone: '044 2000 0000' })])
    })
  })

  scenario('A check refuses a bad row', async ({ admin, createUser }, step) => {
    let agent!: Agent
    await step('"Customer" requires a name', async () => {
      await setUp(admin)
      ;({ agent } = await clerkAgent(admin, createUser))
    })
    let result!: Awaited<ReturnType<Agent['call']>>
    await step('the agent adds a customer with no name', async () => {
      result = await agent.call('create_row', { table: 'Customer', values: { city: 'Salem' } })
    })
    await step('nothing is added', async () => {
      expect(result.isError).toBe(true)
      expect((await admin.get<{ count: number }>(`${CUSTOMER.url}:count`)).count).toBe(3)
    })
    await step('the agent is told the name is required', () => expect(refusalText(result)).toMatch(/customer_name: .*required/i))
  })

  scenario('Moving a customer', async ({ admin, createUser }, step) => {
    const ids = await setUp(admin)
    const { user, agent } = await clerkAgent(admin, createUser)
    const acme = ids['Acme Traders']!
    const before = await admin.get<Row>(CUSTOMER.rowUrl(acme))
    await step('the agent changes the city of "Acme Traders" to "Madurai"', () => agentMoves(agent, acme, 'Madurai'))
    const after = await admin.get<Row>(CUSTOMER.rowUrl(acme))
    await step('"Acme Traders" is in Madurai', () => expect(after.city).toBe('Madurai'))
    await step('its other values are unchanged', () => {
      for (const column of ['customer_name', 'customer_type', 'credit_limit']) expect(after[column]).toEqual(before[column])
      expect(after.contacts).toEqual(before.contacts)
    })
    await step('its history shows the user made the change', async () => {
      const change = (await history(admin, acme)).at(-1)!
      expect(change.created_by).toBe(user.user)
      expect(change.data.changed).toEqual([['city', 'Chennai', 'Madurai']])
    })
  })

  scenario('An agent\'s update of a row changed since it read it is refused', async ({ admin, createUser }, step) => {
    const ids = await setUp(admin)
    const { user, agent } = await clerkAgent(admin, createUser)
    const acme = ids['Acme Traders']!
    let read!: Row
    await step('the agent has read "Acme Traders"', async () => {
      read = await agent.ok<Row>('get_row', { table: 'Customer', id: acme })
    })
    await step('the user has since changed its city to "Salem" themselves', async () => {
      const { updated_at } = await user.get<Row>(CUSTOMER.rowUrl(acme))
      await patchDoc(user, CUSTOMER.rowUrl(acme), { city: 'Salem', updated_at })
    })
    let result!: Awaited<ReturnType<Agent['call']>>
    await step('the agent changes the city of "Acme Traders" to "Madurai"', async () => {
      result = await agent.call('update_row', { table: 'Customer', id: acme, values: { city: 'Madurai' }, updated_at: read.updated_at })
    })
    await step('"Acme Traders" is still in Salem', async () => expect((await admin.get<Row>(CUSTOMER.rowUrl(acme))).city).toBe('Salem'))
    await step('the agent is told it was changed after it read it', () => {
      expect(result.isError).toBe(true)
      expect(refusalText(result)).toMatch(/^ConflictError: .*has been modified after you loaded it/)
    })
  })

  scenario('An agent\'s update without the version it read is refused', async ({ admin, createUser }, step) => {
    const ids = await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    const acme = ids['Acme Traders']!
    let result!: Awaited<ReturnType<Agent['call']>>
    await step('the agent changes the city of "Acme Traders" to "Madurai" without saying which version it read', async () => {
      result = await agent.call('update_row', { table: 'Customer', id: acme, values: { city: 'Madurai' } })
    })
    await step('"Acme Traders" is still in Chennai', async () => expect((await admin.get<Row>(CUSTOMER.rowUrl(acme))).city).toBe('Chennai'))
    await step('the agent is told to read the row first', () => {
      expect(result.isError).toBe(true)
      expect(refusalText(result)).toMatch(/read the row first.*updated_at/i)
    })
  })

  scenario('Deleting without the right is refused', async ({ admin, createUser }, step) => {
    let agent!: Agent
    let ids: Record<string, string> = {}
    await step('the user may change customers but not delete them', async () => {
      ids = await setUp(admin)
      ;({ agent } = await clerkAgent(admin, createUser))
    })
    let result!: Awaited<ReturnType<Agent['call']>>
    await step('the agent deletes "Coral Mart"', async () => {
      const { updated_at } = await agent.ok<Row>('get_row', { table: 'Customer', id: ids['Coral Mart'] })
      result = await agent.call('delete_row', { table: 'Customer', id: ids['Coral Mart'], updated_at })
    })
    await step('"Coral Mart" is still there', async () =>
      expect((await admin.get<Row>(CUSTOMER.rowUrl(ids['Coral Mart']!))).customer_name).toBe('Coral Mart'))
    await step('the agent is told the user may not delete customers', () => {
      expect(result.isError).toBe(true)
      expect(refusalText(result)).toMatch(/^PermissionError: .*delete.*Customer/i)
    })
  })

  scenario('Deleting is flagged for approval', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    let tools: Record<string, { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined> = {}
    await step('the agent\'s app lists what the agent can do', async () => {
      tools = Object.fromEntries((await agent.client.listTools()).tools.map((t) => [t.name, t.annotations]))
    })
    await step('finding and opening rows are marked as reading only', () => {
      for (const name of ['list_tables', 'describe_table', 'query_rows', 'get_row']) expect(tools[name]).toMatchObject({ readOnlyHint: true })
    })
    await step('changing and deleting a row are marked as altering existing data', () => {
      for (const name of ['update_row', 'delete_row']) expect(tools[name]).toMatchObject({ readOnlyHint: false, destructiveHint: true })
      expect(tools.create_row).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    })
  })

  scenario('An unknown column is named', async ({ admin, createUser }, step) => {
    const ids = await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    const acme = ids['Acme Traders']!
    const before = await admin.get<Row>(CUSTOMER.rowUrl(acme))
    let result!: Awaited<ReturnType<Agent['call']>>
    await step('the agent changes the "region" of "Acme Traders" and "Customer" has no such column', async () => {
      const { updated_at } = await agent.ok<Row>('get_row', { table: 'Customer', id: acme })
      result = await agent.call('update_row', { table: 'Customer', id: acme, values: { region: 'South' }, updated_at })
    })
    await step('"Acme Traders" is unchanged', async () => expect(await admin.get<Row>(CUSTOMER.rowUrl(acme))).toEqual(before))
    await step('the agent is told "Customer" has no column "region"', () => {
      expect(result.isError).toBe(true)
      expect(refusalText(result)).toMatch(/region: Unknown field region on Customer/)
    })
  })

  scenario('A region for every customer', async ({ admin, createUser }, step) => {
    await step('the user may build Tables', () => setUp(admin))
    const { agent } = await builderAgent(createUser)
    await step('the agent adds a "region" column to "Customer"', () =>
      agent.ok('add_column', { table: 'Customer', column: { name: 'region', type: 'Data' } }))
    await step('every customer has a region, empty for now', async () => {
      const rows = (await admin.get<{ data: Row[] }>(CUSTOMER.listUrl({ fields: ['customer_name', 'region'] }))).data
      expect(rows).toHaveLength(3)
      for (const row of rows) expect(row).toHaveProperty('region', null)
    })
  })

  scenario('A city cannot become a number', async ({ admin, createUser }, step) => {
    await step('the user may build Tables', () => setUp(admin))
    const { agent } = await builderAgent(createUser)
    let result!: Awaited<ReturnType<Agent['call']>>
    await step('the agent changes the city column of "Customer" to hold numbers', async () => {
      result = await agent.call('change_column', { table: 'Customer', column: 'city', type: 'Int' })
    })
    await step('the city column still holds text, with every customer\'s city', async () => {
      const meta = await admin.get<{ columns: { column_name: string; column_type: string }[] }>(CUSTOMER.metaUrl)
      expect(meta.columns.find((c) => c.column_name === 'city')?.column_type).toBe('Data')
      expect((await customers(admin)).map((c) => c.city).sort()).toEqual(['Chennai', 'Chennai', 'Madurai'])
    })
    await step('the agent is told the city\'s type cannot change', () => {
      expect(result.isError).toBe(true)
      expect(refusalText(result)).toMatch(/city: column_type cannot change \(Data -> Int\)/)
    })
  })

  scenario('Shaping a Table needs the right to build Tables', async ({ admin, createUser }, step) => {
    let agent!: Agent
    await step('the user may change customers but may not build Tables', async () => {
      await setUp(admin)
      ;({ agent } = await clerkAgent(admin, createUser))
    })
    let result!: Awaited<ReturnType<Agent['call']>>
    await step('the agent adds a "region" column to "Customer"', async () => {
      result = await agent.call('add_column', { table: 'Customer', column: { name: 'region', type: 'Data' } })
    })
    await step('"Customer" has no region column', async () => {
      const meta = await admin.get<{ columns: { column_name: string }[] }>(CUSTOMER.metaUrl)
      expect(meta.columns.map((c) => c.column_name)).not.toContain('region')
    })
    await step('the agent is told building Tables needs the System Manager role', () => {
      expect(result.isError).toBe(true)
      expect(refusalText(result)).toMatch(/^PermissionError: Requires the System Manager role/)
    })
  })

  scenario('Suppliers get a Table of their own', async ({ admin, createUser }, step) => {
    await step('the user may build Tables', () => setUp(admin, false))
    const { agent } = await builderAgent(createUser)
    let csv = ''
    await step('a file of suppliers headed "Supplier", "Phone" and "Since", with dates under "Since"', () => {
      csv = 'Supplier,Phone,Since\nKaveri Mills,044 2000 1111,2024-01-15\nVaigai Dyes,0452 300 400,2025-06-30\n'
    })
    await step('the agent asks which Table would hold the file and creates the "Supplier" Table it is offered', async () => {
      const offered = await agent.ok<Record<string, unknown>>('suggest_table', { table: 'Supplier', csv })
      await agent.ok('create_table', offered)
    })
    let columns: { column_name: string; column_type: string }[] = []
    await step('"Supplier" has a supplier, a phone and a since column', async () => {
      columns = (await admin.get<{ columns: { column_name: string; column_type: string }[] }>(tableRef('Supplier').metaUrl)).columns
      expect(columns.map((c) => c.column_name)).toEqual(expect.arrayContaining(['supplier', 'phone', 'since']))
    })
    await step('the since column holds dates', () => expect(columns.find((c) => c.column_name === 'since')?.column_type).toBe('Date'))
  })

  scenario('A bad row is named', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    let csv = ''
    await step('a file of three customers whose second has the type "Online"', () => {
      csv = 'Customer Name,Customer Type,City\nDhan Agencies,Retail,Salem\nElan Exports,Online,Erode\nFab Foods,Wholesale,Trichy\n'
    })
    let report!: Check
    await step('the agent checks the file against "Customer"', async () => {
      report = await agent.ok<Check>('check_import', { table: 'Customer', csv })
    })
    await step('it is told two rows are ready and row 3 of the file is refused for its type', () => {
      expect(report.valid).toBe(2)
      expect(report.failed).toEqual([expect.objectContaining({ row: 3, fields: { customer_type: expect.stringMatching(/Online/) } })])
    })
    await step('no customer has been added', async () => expect(await customers(admin)).toHaveLength(3))
  })

  scenario('The checked file is imported', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser, 'Claude on my laptop')
    const args = { table: 'Customer', csv: 'Customer Name,City\nDhan Agencies,Salem\nElan Exports,Erode\nFab Foods,Trichy\n' }
    let check!: Check
    await step('the agent has checked a file of three customers and all three are ready', async () => {
      check = await agent.ok<Check>('check_import', args)
      expect(check).toMatchObject({ valid: 3, failed: [] })
    })
    await step('the agent imports the file', () => agent.ok('run_import', { ...args, check: check.check }))
    let added: Row[] = []
    await step('the three customers are added', async () => {
      added = await customers(admin, [['customer_name', 'in', ['Dhan Agencies', 'Elan Exports', 'Fab Foods']]])
      expect(added).toHaveLength(3)
    })
    await step('each is marked as added through an agent', async () => {
      for (const row of added) {
        const [created] = await history(admin, row.row_id)
        expect(created!.data).toMatchObject({ created: true, agent: { token_label: 'Claude on my laptop' } })
      }
    })
  })

  scenario('A heading named differently goes where the agent says', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    let csv = ''
    await step('a file of customers whose cities are headed "Town"', () => {
      csv = 'Customer Name,Town\nDhan Agencies,Salem\nElan Exports,Erode\n'
    })
    await step('the agent checks and imports the file, saying "Town" is the city', () =>
      importFile(agent, { table: 'Customer', csv, columns: { Town: 'city' } }))
    await step('each new customer is in the town the file gives', async () => {
      const rows = await customers(admin, [['customer_name', 'in', ['Dhan Agencies', 'Elan Exports']]])
      expect(Object.fromEntries(rows.map((r) => [r.customer_name, r.city]))).toEqual({ 'Dhan Agencies': 'Salem', 'Elan Exports': 'Erode' })
    })
  })

  scenario('A file changed after its check is refused', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    const csv = 'Customer Name,City\nDhan Agencies,Salem\nElan Exports,Erode\nFab Foods,Trichy\n'
    let check = ''
    await step('the agent has checked a file of three customers', async () => {
      check = (await agent.ok<Check>('check_import', { table: 'Customer', csv })).check
    })
    let result!: Awaited<ReturnType<Agent['call']>>
    await step('the agent imports the file with a fourth customer added to it', async () => {
      result = await agent.call('run_import', { table: 'Customer', csv: `${csv}Guna Traders,Karur\n`, check })
    })
    await step('no customer is added', async () => expect(await customers(admin)).toHaveLength(3))
    await step('the agent is told to check the file first', () => {
      expect(result.isError).toBe(true)
      expect(refusalText(result)).toMatch(/check_import/)
    })
  })

  scenario('Acme Traders moves to Salem', async ({ admin, createUser }, step) => {
    const ids = await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    await step('the agent imports a file with "Acme Traders" in Salem, matched on the customer\'s name', () =>
      importFile(agent, { table: 'Customer', csv: 'Customer Name,City\nAcme Traders,Salem\n', key_column: 'customer_name' }))
    await step('"Acme Traders" is in Salem', async () => expect((await admin.get<Row>(CUSTOMER.rowUrl(ids['Acme Traders']!))).city).toBe('Salem'))
    await step('there is still only one "Acme Traders"', async () =>
      expect(await customers(admin, [['customer_name', '=', 'Acme Traders']])).toHaveLength(1))
  })

  scenario('The same customers imported twice', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    const args = { table: 'Customer', csv: 'Customer Name,City\nDhan Agencies,Salem\nElan Exports,Erode\n' }
    await step('the agent has imported "Dhan Agencies" and "Elan Exports"', () => importFile(agent, args))
    let result!: Awaited<ReturnType<Agent['call']>>
    await step('the agent imports the same file again without matching on a column', async () => {
      const { check } = await agent.ok<Check>('check_import', args)
      result = await agent.call('run_import', { ...args, check })
    })
    await step('no customer is added', async () => expect(await customers(admin)).toHaveLength(5))
    await step('the agent is told every row is already there by the customer\'s name', () => {
      expect(result.isError).toBe(true)
      expect(refusalText(result)).toMatch(/every row .*already .*customer_name/i)
    })
  })

  scenario('Twenty-one changed cities wait for the count', async ({ admin, createUser }, step) => {
    const names = Array.from({ length: 21 }, (_, i) => `Customer ${String(i + 1).padStart(2, '0')}`)
    await step('"Customer" holds 21 customers in Chennai', async () => {
      await setUp(admin, false)
      for (const name of names) await admin.post(CUSTOMER.url, { customer_name: name, city: 'Chennai' })
    })
    const { agent } = await clerkAgent(admin, createUser)
    let result!: Awaited<ReturnType<Agent['call']>>
    await step('the agent imports a file moving all 21 to Salem, matched on the customer\'s name, without confirming the count', async () => {
      const args = { table: 'Customer', csv: `Customer Name,City\n${names.map((n) => `${n},Salem`).join('\n')}\n`, key_column: 'customer_name' }
      const { check } = await agent.ok<Check>('check_import', args)
      result = await agent.call('run_import', { ...args, check })
    })
    await step('every customer is still in Chennai', async () =>
      expect(new Set((await customers(admin)).map((c) => c.city))).toEqual(new Set(['Chennai'])))
    await step('the agent is told to confirm 21 changed rows', () => {
      expect(result.isError).toBe(true)
      expect(refusalText(result)).toMatch(/confirm_changes: 21/)
    })
  })

  scenario('Undoing the agent\'s import', async ({ admin, createUser }, step) => {
    const ids = await setUp(admin)
    // The list of imports is a reading of the Import Log, under its own read
    // permission; undoing deletes the rows the import added, so it needs delete.
    await grantRole(admin, { role: CLERK, table: 'Import Log', can_read: true })
    await grantRole(admin, { role: CLERK, table: 'Customer', can_delete: true })
    const { agent } = await clerkAgent(admin, createUser)
    await step('the agent has imported a file that added "Dhan Agencies" and moved "Acme Traders" to Salem', () =>
      importFile(agent, { table: 'Customer', csv: 'Customer Name,City\nDhan Agencies,Salem\nAcme Traders,Salem\n', key_column: 'customer_name', file_name: 'customers.csv' }))
    await step('the agent undoes that import, found in the list of imports into "Customer"', async () => {
      const { imports } = await agent.ok<{ imports: { run_id: string; file_name: string }[] }>('list_imports', { table: 'Customer' })
      expect(imports[0]).toMatchObject({ file_name: 'customers.csv' })
      await agent.ok('undo_import', { table: 'Customer', run_id: imports[0]!.run_id })
    })
    await step('there is no "Dhan Agencies"', async () =>
      expect(await customers(admin, [['customer_name', '=', 'Dhan Agencies']])).toEqual([]))
    await step('"Acme Traders" is in Chennai again', async () =>
      expect((await admin.get<Row>(CUSTOMER.rowUrl(ids['Acme Traders']!))).city).toBe('Chennai'))
  })

  scenario('Removing a column and importing are flagged for approval', async ({ admin, createUser }, step) => {
    await setUp(admin)
    const { agent } = await clerkAgent(admin, createUser)
    let tools: Record<string, { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined> = {}
    await step('the agent\'s app lists what the agent can do', async () => {
      tools = Object.fromEntries((await agent.client.listTools()).tools.map((t) => [t.name, t.annotations]))
    })
    await step('checking a file is marked as reading only', () => expect(tools.check_import).toMatchObject({ readOnlyHint: true }))
    await step('removing a column, importing a file and undoing an import are marked as altering existing data', () => {
      for (const name of ['remove_column', 'run_import', 'undo_import']) expect(tools[name]).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    })
  })
})
