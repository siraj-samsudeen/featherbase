import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps, setAppEnabled, listInstalledApps } from '../src/apps'
import { sql } from '../src/db'

const directory = resolve('../..', 'example-apps/tickets')
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': 'tickets@0.2.7' },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

type Ticket = { row_id: string; updated_at: string; ticket_state: string; [key: string]: any }
const act = async (client: TestClient, name: string, payload: object, key: string = randomUUID()) =>
  (await client.post<any>(`/api/app_actions/tickets/${name}`, { idempotencyKey: key, payload })).result
// The host wraps read-handler output in result. Tickets' handler returns answer.
const read = async (client: TestClient, name: string, payload: object = {}) =>
  (await client.post<any>(`/api/app_reads/tickets/${name}`, { payload })).result.answer
const revision = (ticket: Ticket) => ({ row_id: ticket.row_id, updated_at: ticket.updated_at })
const detail = (client: TestClient, ticket: Ticket) => read(client, 'detail', { row_id: ticket.row_id })
const settings = async (admin: TestClient, values: Record<string, unknown>) => {
  // No set_app_settings endpoint exists: ordinary App Setting writes are the public API.
  for (const [name, value] of Object.entries(values)) {
    const filters = encodeURIComponent(JSON.stringify([['row_id', '=', `tickets.${name}`]]))
    const current = (await admin.get<any>(`/api/table/App%20Setting?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`)).data[0]
    await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: `tickets.${name}`, updated_at: current?.updated_at, value: JSON.stringify(value) } })
  }
}
async function setup(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'tickets' })
  const person = (name: string, staff = false) => createUser({ email: `${name}@tickets.example.test`, roles: staff ? ['Tickets Support'] : [] })
  const owner = await person('anjali')
  const other = await person('colleague')
  const support = await person('triager', true)
  const verifier = await person('verifier', true)
  const bala = await person('bala', true)
  const shiva = await person('shiva', true)
  const karthik = await person('karthik', true)
  const fulfiller = await person('fulfiller', true)
  await settings(admin, { support_users: [support.user, verifier.user, bala.user, shiva.user, karthik.user, fulfiller.user],
    verification_admins: [verifier.user], fulfillment_admins: [fulfiller.user],
    approval_routes: { Kerala: [bala.user], Chennai: [karthik.user, shiva.user] }, restricted_resources: ['Bronze'] })
  return { owner, other, support, verifier, bala, shiva, karthik, fulfiller }
}
const create = async (client: TestClient, kind = 'access', details: object = { email: 'anjali@example.com', scope: 'Gold sales, read only' }) =>
  (await act(client, 'create', { title: 'Warehouse help', original: 'Original private request 37', kind, details })).ticket as Ticket
const verify = async (client: TestClient, ticket: Ticket, active = true, region = 'Kerala') =>
  (await act(client, 'verify', { ...revision(ticket), email: 'anjali@example.com', active, region, evidence: 'Fictional HR confirmation 2026-11-03' })).ticket as Ticket
const approve = async (client: TestClient, ticket: Ticket) =>
  (await act(client, 'decide', { ...revision(ticket), decision: 'approved' })).ticket as Ticket
async function refused(promise: Promise<unknown>, statuses = [403, 409, 417]) {
  let failure: any
  try { await promise } catch (error) { failure = error }
  expect(failure, 'the forbidden write must not succeed').toBeDefined()
  expect(statuses).toContain(failure.status)
}
const serialized = (value: unknown) => JSON.stringify(value)

describe('Tickets independently installed product contract (#810)', () => {
  test('the separately chosen package exists with the approved identity', async () => {
    const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
    const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
    expect(manifest).toMatchObject({ name: 'tickets', entryTable: 'tickets.ticket' })
    expect(pkg.version).toBe('0.2.7')
  })

  test('app-free discovery has no tickets; explicit install has no samples or fake integrations', async ({ admin, createUser }) => {
    await discoverPackages([])
    await refused(admin.post('/api/install_app', { name: 'tickets' }), [404, 417])
    const { support } = await setup(admin, createUser)
    expect((await read(support, 'queue')).tickets).toEqual([])
    const session = await read(support, 'session')
    expect(session.user).toBeDefined()
    expect(session.capabilities).toBeDefined()
    expect(serialized(session.connections)).toContain('unconfigured')
    for (const integration of ['employee', 'email', 'investigation'])
      expect(serialized(session.connections).toLowerCase()).toContain(integration)
    expect(serialized(session.connections)).not.toMatch(/"(?:connected|executed|matched)":true/)
  })

  test('free text, structured categories, immutable original and durable idempotent creation', async ({ admin, createUser }) => {
    const { owner, support } = await setup(admin, createUser)
    const payload = { title: 'Please give me MotherDuck access', original: 'Please give me MotherDuck access', kind: 'generic', details: {} }
    const first = await act(owner, 'create', payload, 'one-request')
    expect(first.ticket.row_id).toEqual(expect.any(String))
    expect(await act(owner, 'create', payload, 'one-request')).toEqual(first)
    await discoverPackages([directory]); await loadInstalledApps()
    expect(await act(owner, 'create', payload, 'one-request')).toEqual(first)
    const classified = await act(support, 'edit', { ...revision(first.ticket), kind: 'access', details: { email: 'anjali@example.com', scope: 'Gold sales, read only' } })
    const saved = await detail(owner, classified.ticket)
    expect(serialized(saved.details)).toContain(payload.original)
    expect(serialized(saved.details)).toContain('Gold sales, read only')
    const request = await admin.get<any>(`/api/table/tickets.request/${first.ticket.row_id}`)
    await refused(admin.post('/api/save_row', { table: 'tickets.request', row: { ...request, original: 'Rewritten' } }))
    expect((await admin.get<any>(`/api/table/tickets.request/${first.ticket.row_id}`)).original).toBe(payload.original)
    const examples = [
      ['report', { location: 'Palakkad', from: '2026-10-01', through: '2026-10-31', format: 'Excel' }],
      ['freshness', { source: 'Zakya', report: 'daily sales', date: '2026-11-01', expected: 'cleared invoices' }],
      ['source', { source: 'vendor API', data: 'daily stock movements', refresh: 'hourly' }],
      ['quality', { expected: '2', observed: '0' }],
      ['schema', { model: 'sales', column: 'warehouse' }],
      ['pipeline', { pipeline: 'sales import', failure: 'timeout' }],
      ['backfill', { source: 'Zakya', from: '2026-10-01', through: '2026-10-31' }],
    ] as const
    for (const [kind, details] of examples) {
      const ticket = await create(owner, kind, details)
      const stored = serialized((await detail(owner, ticket)).details)
      for (const value of Object.values(details)) expect(stored).toContain(value)
      expect(stored).not.toContain('confirmed_root_cause')
    }
  })

  test('a verifier, regional approver and distinct fulfillment admin complete exactly the current scope', async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    let ticket = await create(w.owner)
    await refused(approve(w.bala, ticket))
    await refused(verify(w.owner, ticket))
    ticket = await verify(w.verifier, ticket)
    const verified = serialized(await detail(w.support, ticket))
    for (const text of ['anjali@example.com', 'Kerala', w.verifier.user, 'Fictional HR confirmation']) expect(verified).toContain(text)
    expect(verified).toMatch(/2026-\d\d-\d\dT/)
    await refused(approve(w.shiva, ticket))
    ticket = await approve(w.bala, ticket)
    const decision = serialized(await detail(w.support, ticket))
    expect(decision).toContain(w.bala.user)
    expect(decision).toContain('Gold sales, read only')
    await refused(act(w.bala, 'fulfill', { ...revision(ticket), reference: 'Cannot fulfill' }))
    ticket = (await act(w.fulfiller, 'fulfill', { ...revision(ticket), reference: 'Manual admin confirmation 41' })).ticket
    expect(ticket.ticket_state).toBe('Resolved')
    const completed = serialized(await detail(w.support, ticket))
    expect(completed).toContain(w.fulfiller.user)
    expect(completed).toContain('Manual admin confirmation 41')
    expect(completed).not.toMatch(/"(?:automated_grant|access_granted_automatically)":true/)
  })

  test('either Chennai approver suffices, replay is stable, and a stale competing rejection cannot replace approval', async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    const ticket = await verify(w.verifier, await create(w.owner), true, 'Chennai')
    const payload = { ...revision(ticket), decision: 'approved' }
    const accepted = await act(w.shiva, 'decide', payload, 'shiva-decision')
    expect(await act(w.shiva, 'decide', payload, 'shiva-decision')).toEqual(accepted)
    await refused(act(w.karthik, 'decide', { ...revision(ticket), decision: 'rejected', reason: 'Stale tab' }), [409, 417])
    expect((await detail(w.support, accepted.ticket)).ticket.ticket_state).toBe('Approved')
    const final = (await act(w.fulfiller, 'fulfill', { ...revision(accepted.ticket), reference: 'One alternative was sufficient' })).ticket
    expect(final.ticket_state).toBe('Resolved')
    // Concurrent decisions run in Tickets' HTTP acceptance flow: this fixture
    // shares one rollback transaction, so both calls would own the same lock.
  })

  for (const change of ['scope', 'email', 'region', 'inactive'] as const) {
    test(`${change} invalidates the dependent access gates but retains prior history`, async ({ admin, createUser }) => {
      const w = await setup(admin, createUser)
      let ticket = await approve(w.bala, await verify(w.verifier, await create(w.owner)))
      if (change === 'region' || change === 'inactive')
        ticket = await verify(w.verifier, ticket, change !== 'inactive', change === 'region' ? 'Chennai' : 'Kerala')
      else ticket = (await act(w.support, 'edit', { ...revision(ticket), details: {
        email: change === 'email' ? 'another@example.com' : 'anjali@example.com',
        scope: change === 'scope' ? 'Silver SAP, read only' : 'Gold sales, read only',
      } })).ticket
      await refused(act(w.fulfiller, 'fulfill', { ...revision(ticket), reference: 'Stale approval' }))
      const history = serialized(await detail(w.support, ticket))
      expect(history).toContain(w.bala.user)
      expect(history).toContain('Gold sales, read only')
      if (change === 'scope') {
        ticket = await approve(w.bala, ticket)
        expect((await act(w.fulfiller, 'fulfill', { ...revision(ticket), reference: 'Fresh scope approval' })).ticket.ticket_state).toBe('Resolved')
      } else if (change === 'region') {
        await refused(approve(w.bala, ticket))
        ticket = await approve(w.shiva, ticket)
        expect((await act(w.fulfiller, 'fulfill', { ...revision(ticket), reference: 'New route' })).ticket.ticket_state).toBe('Resolved')
      } else await refused(approve(w.bala, ticket))
    })
  }

  test("the requester's own scope or recipient change is attributed in support history", async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    let ticket = await approve(w.bala, await verify(w.verifier, await create(w.owner)))
    ticket = (await act(w.owner, 'edit', { ...revision(ticket), details: { scope: 'Silver SAP, read only' } })).ticket
    await refused(act(w.fulfiller, 'fulfill', { ...revision(ticket), reference: 'Stale approval' }))
    const edits = (await detail(w.support, ticket)).privateEvents.filter((e: any) => e.operation === 'edit')
    expect(edits).toHaveLength(1)
    expect(edits[0].by).toBe(w.owner.user)
    expect(edits[0].text).toContain('Gold sales, read only')
    expect(edits[0].text).toContain('Silver SAP, read only')
    // The requester still sees no support history of their own ticket.
    expect((await detail(w.owner, ticket)).privateEvents).toBeUndefined()
    // Generic reads reach only the requester's own edit, never verification or decisions.
    const own = (await w.owner.get<any>(`/api/table/tickets.event?fields=${encodeURIComponent('["operation","by"]')}`)).data
    expect(own).toEqual([{ operation: 'edit', by: w.owner.user }])
  })

  // #912: the CLI installs (or an administrator enables) from another process
  // while this server runs. Disabling here and enabling the row directly is
  // that situation: the database says enabled, this process has not wired it.
  test('an app installed or enabled by another process works at once, with no restart', async ({ admin, createUser }) => {
    const { owner } = await setup(admin, createUser)
    await setAppEnabled('tickets', false)
    await sql`update installed_app set enabled = true where name = 'tickets'`
    expect((await create(owner, 'generic', {})).row_id).toEqual(expect.any(String))
    expect((await listInstalledApps()).find(app => app.name === 'tickets')).toMatchObject({ active: true, recovery: null })
  })

  test('a changed app under the same version is refused with the reason and what to do, not a bare access refusal', async ({ admin, createUser }) => {
    const { owner } = await setup(admin, createUser)
    await setAppEnabled('tickets', false)
    await sql`update installed_app set enabled = true, artifact_digest = 'an-earlier-build' where name = 'tickets'`
    let failure: any
    try { await create(owner, 'generic', {}) } catch (error) { failure = error }
    expect(failure?.status).toBe(403)
    expect(failure.message).not.toContain('Application access refused')
    expect(failure.message).toMatch(/tickets 0\.2\.7.*files changed.*same version/i)
    expect(failure.message).toMatch(/new version|install-app tickets/)
    const listed = (await listInstalledApps()).find(app => app.name === 'tickets')
    expect(listed).toMatchObject({ active: false })
    expect(listed?.recovery).toMatch(/files changed.*same version/i)
  })

  test('people are shown by name: requester, assignee, verifier, approver and history', async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    expect((await read(w.owner, 'session')).user).toEqual({ row_id: w.owner.user, full_name: 'anjali' })
    let ticket = await create(w.owner)
    ticket = (await act(w.support, 'edit', { ...revision(ticket), assigned_to: w.support.user, public_update: 'Checking' })).ticket
    ticket = await approve(w.bala, await verify(w.verifier, ticket))
    const queue = await read(w.support, 'queue')
    expect(queue.names).toMatchObject({ [w.owner.user!]: 'anjali', [w.support.user!]: 'triager' })
    const seen = await detail(w.support, ticket)
    expect(seen.names).toMatchObject({ [w.owner.user!]: 'anjali', [w.support.user!]: 'triager', [w.verifier.user!]: 'verifier', [w.bala.user!]: 'bala' })
    // Another requester sees the names on what they may see, never an opaque id for a person who acted.
    const shared = await detail(w.other, ticket)
    expect(shared.names).toMatchObject({ [w.owner.user!]: 'anjali', [w.support.user!]: 'triager' })
    expect(shared.names[w.verifier.user!]).toBeUndefined()
    // Support can choose an assignee by name from the people configured for Tickets.
    const people = (await read(w.support, 'session')).people as { row_id: string; full_name: string }[]
    expect(people).toEqual(expect.arrayContaining([{ row_id: w.bala.user, full_name: 'bala' }]))
    expect((await read(w.owner, 'session')).people).toBeUndefined()
    // Names come only from the platform, for the person acting: no generic write can set one.
    await refused(w.other.post('/api/table/tickets.member', { row_id: w.other.user, full_name: 'bala' }))
  })

  test('people listed as assignable are offered for assignment without support rights (#964)', async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    // Names are known for people who have used Tickets.
    let ticket = await create(w.owner, 'generic', {})
    ticket = (await act(w.support, 'edit', { ...revision(ticket), public_update: 'Checking' })).ticket
    await create(w.other, 'generic', {})
    const offered = async () => ((await read(w.support, 'session')).people as { row_id: string }[]).map(p => p.row_id)
    // An empty setting changes nothing: support is offered, a requester is not.
    expect(await offered()).toContain(w.support.user)
    expect(await offered()).not.toContain(w.other.user)
    await settings(admin, { assignees: [w.other.user] })
    expect(await offered()).toEqual(expect.arrayContaining([w.other.user, w.support.user]))
    ticket = (await act(w.support, 'edit', { ...revision(ticket), assigned_to: w.other.user })).ticket
    expect(ticket.assigned_to).toBe(w.other.user)
    // Being assignable gives no support rights.
    const session = await read(w.other, 'session')
    expect(session.capabilities.support).toBe(false)
    expect(session.people).toBeUndefined()
    await refused(act(w.other, 'edit', { ...revision(ticket), public_update: 'Looking' }))
  })

  test('people named in the settings are offered by name before they have used Tickets (#1097)', async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    const newcomer = await createUser({ email: 'newcomer@tickets.example.test', fullName: 'Newcomer' })
    const stranger = await createUser({ email: 'stranger@tickets.example.test', fullName: 'Stranger' })
    await settings(admin, { assignees: [newcomer.user] })
    const people = (await read(w.support, 'session')).people as { row_id: string; full_name: string }[]
    expect(people).toEqual(expect.arrayContaining([{ row_id: newcomer.user, full_name: 'Newcomer' }]))
    // Someone the settings don't name stays as hidden as before from a viewer who can't read Person.
    let ticket = await create(w.owner, 'generic', {})
    ticket = (await act(w.support, 'edit', { ...revision(ticket), assigned_to: stranger.user })).ticket
    expect((await detail(w.support, ticket)).names[stranger.user!]).toBeUndefined()
    // A retired person left in a setting is not named that way.
    await sql`update person set retired_at = now() where row_id = ${newcomer.user!}`
    const after = (await read(w.support, 'session')).people as { row_id: string }[]
    expect(after.map(p => p.row_id)).not.toContain(newcomer.user)
  })

  test("after the requester's own scope change only re-approval is needed; a recipient change needs verification", async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    let ticket = await approve(w.bala, await verify(w.verifier, await create(w.owner)))
    ticket = (await act(w.owner, 'edit', { ...revision(ticket), details: { scope: 'Silver SAP, read only' } })).ticket
    expect(ticket.ticket_state).toBe('Awaiting approval')
    ticket = await approve(w.bala, ticket)
    ticket = (await act(w.owner, 'edit', { ...revision(ticket), details: { email: 'another@example.com' } })).ticket
    expect(ticket.ticket_state).toBe('Needs verification')
    let inactive = await verify(w.verifier, await create(w.owner), false)
    inactive = (await act(w.owner, 'edit', { ...revision(inactive), details: { scope: 'Gold finance, read only' } })).ticket
    expect(inactive.ticket_state).toBe('Needs verification')
    let bronze = await verify(w.verifier, await create(w.owner))
    bronze = (await act(w.owner, 'edit', { ...revision(bronze), details: { resource: 'Bronze Zakya' } })).ticket
    expect(bronze.ticket_state).toBe('Policy review')
  })

  test('inactive, unknown-region, restricted-resource and empty configuration fail closed; settings changes revoke old memberships', async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    for (const [active, region, scope] of [[false, 'Kerala', 'Gold'], [true, 'Unknown', 'Gold'], [true, 'Kerala', 'Bronze Zakya']] as const) {
      const ticket = await verify(w.verifier, await create(w.owner, 'access', { email: 'anjali@example.com', scope }), active, region)
      await refused(approve(w.bala, ticket))
      await refused(act(w.fulfiller, 'fulfill', { ...revision(ticket), reference: 'Bypass' }))
    }
    let ticket = await create(w.owner)
    await settings(admin, { verification_admins: [], approval_routes: {}, fulfillment_admins: [] })
    await refused(verify(w.verifier, ticket))
    await settings(admin, { verification_admins: [w.support.user!], approval_routes: { Kerala: [w.shiva.user!] }, fulfillment_admins: [w.support.user!] })
    ticket = await verify(w.support, ticket)
    await refused(approve(w.bala, ticket))
    ticket = await approve(w.shiva, ticket)
    await refused(act(w.fulfiller, 'fulfill', { ...revision(ticket), reference: 'Revoked member' }))
    expect((await act(w.support, 'fulfill', { ...revision(ticket), reference: 'Second configuration' })).ticket.ticket_state).toBe('Resolved')
  })

  test('generic writes and role-only membership cannot forge workflow facts, attribution or immutable history, even as Administrator', async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    const ticket = await create(w.owner)
    const roleOnly = await createUser({ email: 'role-only@tickets.example.test', roles: ['Tickets Support'] })
    await refused(verify(roleOnly, ticket))
    await refused(act(roleOnly, 'edit', { ...revision(ticket), assigned_to: roleOnly.user }))
    const request = await admin.get<any>(`/api/table/tickets.request/${ticket.row_id}`)
    for (const client of [w.other, w.owner, admin])
      await refused(client.post(`/api/table/tickets.ticket/${ticket.row_id}:rename`, { new_name: 'hijacked-reference' }))
    expect(serialized((await detail(w.owner, ticket)).details)).toContain('Original private request 37')
    for (const client of [w.owner, w.support, admin]) {
      await refused(client.post('/api/save_row', { table: 'tickets.ticket', row: { ...ticket, ticket_state: 'Resolved' } }))
      await refused(client.post('/api/save_row', { table: 'tickets.request', row: { ...request,
        verification_key: 'forged-verification', approval_key: 'forged-approval',
      } }))
      await refused(client.post('/api/save_row', { table: 'tickets.event', row: { ticket: ticket.row_id,
        operation: 'verify', text: JSON.stringify({ email: 'anjali@example.com', active: true, region: 'Kerala', verification_key: request.verification_key }),
        by: w.verifier.user, at: '2026-11-03T09:00:00Z',
      } }))
    }
    const unchanged = await admin.get<any>(`/api/table/tickets.request/${ticket.row_id}`)
    expect(unchanged.verification_key).toBe(request.verification_key)
    expect(unchanged.approval_key).toBe(request.approval_key)
    await refused(act(w.support, 'resolve', { ...revision(ticket), reason: 'Ordinary resolution', reference: 'Not fulfillment' }))
    await refused(approve(w.bala, ticket))
    expect((await detail(w.owner, ticket)).ticket.ticket_state).not.toBe('Resolved')
  })

  test('shared summaries and progress never disclose request details, employee evidence or internal notes through reads, exports, search or activity', async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    let ticket = await create(w.owner)
    ticket = await verify(w.verifier, ticket)
    ticket = (await act(w.support, 'note', { ...revision(ticket), text: 'PRIVATE diagnostic 431' })).ticket
    ticket = (await act(w.support, 'edit', { ...revision(ticket), public_update: 'We are checking the request' })).ticket
    expect((await read(w.other, 'queue')).tickets).toContainEqual(expect.objectContaining({ row_id: ticket.row_id }))
    const publicDetail = await detail(w.other, ticket)
    expect(publicDetail.ticket.row_id).toBe(ticket.row_id)
    expect(serialized(publicDetail)).toContain('We are checking the request')
    expect(publicDetail.details).toBeUndefined()
    for (const client of [w.owner, w.other]) {
      const responses: unknown[] = [await detail(client, ticket), await client.get(`/api/activity/tickets.ticket/${ticket.row_id}`),
        await client.get('/api/table/tickets.ticket?limit_page_length=500'), await client.get('/api/search?q=431')]
      for (const value of responses) {
        expect(serialized(value)).not.toContain('PRIVATE diagnostic 431')
        expect(serialized(value)).not.toContain('Fictional HR confirmation')
      }
      await refused(client.get(`/api/table/tickets.event/${ticket.row_id}`), [403, 404])
      const events = await client.get<any>('/api/table/tickets.event?limit_page_length=500').catch((e: any) => {
        expect(e.status).toBe(403); return { data: [] }
      })
      expect(events.data).toEqual([])
    }
    await refused(w.other.get(`/api/table/tickets.request/${ticket.row_id}`), [403, 404])
    const exported = await w.other.get<any>('/api/table/tickets.request?fields=["row_id","original","details_json"]&limit_page_length=500')
    expect(exported.data).toEqual([])
    const requestActivity = await w.other.fetch(`/api/activity/tickets.request/${ticket.row_id}`)
    expect([403, 404]).toContain(requestActivity.status)
    await refused(act(w.other, 'edit', { ...revision(ticket), details: { scope: 'Bronze' } }))
    await refused(w.other.post('/api/save_row', { table: 'tickets.ticket', row: { ...ticket, title: 'Hijack' } }))
    expect(serialized((await detail(w.owner, ticket)).details)).toContain('Gold sales, read only')
    expect(serialized(await detail(w.support, ticket))).toContain('PRIVATE diagnostic 431')
  })

  test('manual findings, links, supported resolution and reopening preserve attributed history and never invent a root cause', async ({ admin, createUser }) => {
    const w = await setup(admin, createUser)
    let ticket = await create(w.owner, 'freshness', { complaint: 'Missing invoices' })
    expect(serialized(await detail(w.support, ticket))).not.toContain('confirmed_mismatch')
    ticket = (await act(w.support, 'evidence', { ...revision(ticket), expected: '2 invoices from source-check-1', observed: '0 from report-check-1',
      reference: 'source-check-1; report-check-1', observed_at: '2026-11-03T09:00:00Z', finding: 'confirmed_mismatch' })).ticket
    ticket = (await act(w.support, 'link', { ...revision(ticket), url: 'https://github.com/fictional-warehouse/demo/issues/37' })).ticket
    ticket = (await act(w.support, 'resolve', { ...revision(ticket), reason: 'Report refreshed and both invoices present', reference: 'report-check-2' })).ticket
    expect(ticket.ticket_state).toBe('Resolved')
    ticket = (await act(w.support, 'evidence', { ...revision(ticket), expected: '2 invoices', observed: '2 invoices',
      reference: 'post-resolution-confirmation', observed_at: '2026-11-04T09:00:00Z', finding: 'no_mismatch' })).ticket
    expect((await detail(w.support, ticket)).ticket.ticket_state).toBe('Resolved')
    ticket = (await act(w.support, 'reopen', { ...revision(ticket), reason: "The next day's report is still missing invoices" })).ticket
    expect(ticket.ticket_state).not.toBe('Resolved')
    const saved = serialized(await detail(w.support, ticket))
    for (const text of ['confirmed_mismatch', 'source-check-1', 'report-check-1', '2026-11-03T09:00:00', w.support.user,
      'Report refreshed and both invoices present', 'report-check-2', 'post-resolution-confirmation', "The next day's report", '/issues/37']) expect(saved).toContain(text)
    expect(saved).not.toMatch(/"root_cause":"(?!unknown)[^"]+"/)
    const events = await admin.get<any>('/api/table/tickets.event?limit_page_length=500')
    expect(events.data.length).toBeGreaterThan(0)
    const event = await admin.get<any>(`/api/table/tickets.event/${events.data[0].row_id}`)
    await refused(admin.post('/api/save_row', { table: 'tickets.event', row: { ...event, text: 'Rewrite history' } }))
    await refused(admin.fetch(`/api/table/tickets.event/${event.row_id}?updated_at=${encodeURIComponent(event.updated_at)}`, { method: 'DELETE' }).then(async response => {
      if (!response.ok) throw { status: response.status }
      return response.json()
    }))
  })
})
