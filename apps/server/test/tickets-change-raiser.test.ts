import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { expectStatus, makeTable } from './fixtures'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { callerDocuments } from '../src/runtime-actions'
import { enabledPeople } from '../src/people-directory'
import { sql } from '../src/db'

// #963: a System Manager corrects who raised a ticket; nothing else can.
const directory = resolve('../..', 'example-apps/tickets')
const { version } = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { version: string }
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': `tickets@${version}` },
}) }, client.token, client.user)
type Person = TestClient & { user: string }
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
type Ticket = { row_id: string; updated_at: string; owner: string; ticket_state: string; assigned_to?: string | null; [key: string]: any }
const act = async (client: TestClient, name: string, payload: object, idempotencyKey: string = randomUUID()) =>
  (await client.post<any>(`/api/app_actions/tickets/${name}`, { idempotencyKey, payload })).result
const read = async (client: TestClient, name: string, payload: object = {}) =>
  (await client.post<any>(`/api/app_reads/tickets/${name}`, { payload })).result.answer
const revision = (ticket: Ticket) => ({ row_id: ticket.row_id, updated_at: ticket.updated_at })
async function refused(promise: Promise<unknown>, message?: RegExp, statuses = [403, 409, 417]) {
  let failure: any
  try { await promise } catch (error) { failure = error }
  expect(failure, 'the forbidden write must not succeed').toBeDefined()
  expect(statuses).toContain(failure.status)
  if (message) expect(JSON.stringify(failure.body ?? failure.message)).toMatch(message)
  return failure
}
const save = (admin: TestClient, table: string, row: object) => admin.post<any>('/api/save_row', { table, row })
const transitions = [
  { state: 'Raised', action: 'Ask a question', next_state: 'Waiting for raiser', allowed: 'assignee', fields: ['question'] },
  { state: 'Waiting for raiser', action: 'Answer', next_state: 'Raised', allowed: 'requester', fields: ['answer'] },
]
async function world(admin: TestClient, createUser: CreateUserFn, visibility: 'everyone' | 'private' = 'everyone') {
  await discoverPackages([directory])
  await admin.post('/api/install_app', { name: 'tickets' })
  const raiser = await createUser({ email: 'raiser@tickets.example.test', fullName: 'Raiser' })
  const next = await createUser({ email: 'next@tickets.example.test', fullName: 'Next Raiser' })
  const colleague = await createUser({ email: 'colleague@tickets.example.test', fullName: 'Colleague' })
  const support = await createUser({ email: 'triager@tickets.example.test', fullName: 'Triager', roles: ['Tickets Support'] })
  const manager = await createUser({ email: 'manager@tickets.example.test', fullName: 'Manager', roles: ['System Manager'] })
  const filters = encodeURIComponent(JSON.stringify([['row_id', '=', 'tickets.support_users']]))
  const current = (await admin.get<any>(`/api/table/App%20Setting?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`)).data[0]
  await save(admin, 'App Setting', { row_id: 'tickets.support_users', updated_at: current?.updated_at, value: JSON.stringify([support.user]) })
  const type = await save(admin, 'tickets.ticket_type', { type_key: 'data_quality_issue', label: 'Data Quality Issue', enabled: true,
    states: 'Raised\nWaiting for raiser\nClosed', done_states: 'Closed', transitions: JSON.stringify(transitions), details_visible_to: visibility })
  for (const [field_name, label] of [['current_value', 'Current value'], ['question', 'Question'], ['answer', 'Answer']])
    await save(admin, 'tickets.type_field', { ticket_type: type.row_id, field_name, label, field_type: 'text' })
  const raise = async () => (await act(raiser, 'create', { title: 'Plant address is wrong', original: 'Two plants carry both door numbers',
    kind: 'data_quality_issue', details: { current_value: '78/499/1' } })).ticket as Ticket
  return { raiser: raiser as Person, next: next as Person, colleague: colleague as Person, support: support as Person, manager: manager as Person, raise }
}
const change = (client: TestClient, ticket: Ticket, new_raiser: string, reason = 'The loader raised it for this person', key?: string) =>
  act(client, 'change_raiser', { ...revision(ticket), new_raiser, reason }, key)
const stored = async (id: string) => (await sql`select owner, title, kind, ticket_state, assigned_to, public_update from tickets.ticket where row_id = ${id}`)[0]
const eventsOf = async (id: string, table = 'tickets.open_event') =>
  sql`select operation, text, by, at from ${sql(table)} where ticket = ${id} and operation = 'change_raiser'`

describe('Tickets: changing who raised a ticket (#963)', () => {
  test('a System Manager changes only the raiser, with the who, when and why in history', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await raise_assigned(w)
    const before = await stored(ticket.row_id)
    const { ticket: changed } = await change(w.manager, ticket, w.next.user, '  The loader raised it for this person ')
    expect(changed.owner).toBe(w.next.user)
    expect(changed.updated_at).not.toBe(ticket.updated_at)
    expect(await stored(ticket.row_id)).toEqual({ ...before, owner: w.next.user })
    const details = await sql`select original, details_json from tickets.open_request where row_id = ${ticket.row_id}`
    expect(details[0]).toMatchObject({ original: 'Two plants carry both door numbers', details_json: JSON.stringify({ current_value: '78/499/1' }) })
    const [event, ...rest] = await eventsOf(ticket.row_id)
    expect(rest).toEqual([])
    expect(event.by).toBe(w.manager.user)
    expect(Number.isFinite(Date.parse(String(event.at)))).toBe(true)
    expect(JSON.parse(String(event.text))).toEqual({ old_raiser: w.raiser.user, new_raiser: w.next.user, reason: 'The loader raised it for this person' })
  })

  test('a service account holding System Manager may change it', async ({ admin, createUser, api }) => {
    const w = await world(admin, createUser)
    const ticket = await w.raise()
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'bulk-runner', roles: ['System Manager'] })
    const { token } = await admin.post<{ token: string }>('/api/access_tokens', { label: 'bulk run', owner: account.row_id })
    const response = await api.fetch('/api/app_actions/tickets/change_raiser', { method: 'POST', headers: { authorization: `Bearer ${token}`,
      'content-type': 'application/json', 'X-Featherbase-App-Version': `tickets@${version}` },
    body: JSON.stringify({ idempotencyKey: randomUUID(), payload: { ...revision(ticket), new_raiser: w.next.user, reason: 'Bulk correction' } }) })
    await expectStatus(response, 200)
    expect((await stored(ticket.row_id)).owner).toBe(w.next.user)
    const [event] = await eventsOf(ticket.row_id)
    expect(event.by).toBe(account.row_id)
  })

  test('the built-in Administrator holds the System Manager role, so may change it', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await w.raise()
    expect((await change(admin, ticket, w.next.user)).ticket.owner).toBe(w.next.user)
  })

  test('Tickets support, the raiser and anyone else without System Manager are refused', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await w.raise()
    for (const client of [w.support, w.raiser, w.next, w.colleague])
      await refused(change(client, ticket, w.next.user), /Only a System Manager/)
    expect((await stored(ticket.row_id)).owner).toBe(w.raiser.user)
    expect(await eventsOf(ticket.row_id)).toEqual([])
  })

  test('an unknown, disabled, merged-away, built-in or service account raiser is refused', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await w.raise()
    const left = await createUser({ email: 'left@tickets.example.test', fullName: 'Has Left' }) as Person
    await sql`update person set enabled = false where row_id = ${left.user}`
    const merged = await createUser({ email: 'merged@tickets.example.test', fullName: 'Merged Away' }) as Person
    await sql`update person set enabled = false, replaced_by = ${w.next.user} where row_id = ${merged.user}`
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'other-importer' })
    for (const id of ['psn_doesnotexist', left.user, merged.user, 'Administrator', account.row_id])
      await refused(change(w.manager, ticket, id), /enabled person/)
    await refused(act(w.manager, 'change_raiser', { ...revision(ticket), reason: 'No one named' }), /New raiser is required/)
    expect((await stored(ticket.row_id)).owner).toBe(w.raiser.user)
  })

  test('an empty reason, a stale revision, the same raiser and an extra field are refused', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await w.raise()
    for (const reason of ['', '   ']) await refused(change(w.manager, ticket, w.next.user, reason), /Reason is required/)
    await refused(act(w.manager, 'change_raiser', { ...revision(ticket), new_raiser: w.next.user }), /Reason is required/)
    await refused(change(w.manager, ticket, w.raiser.user), /already the raiser/)
    await refused(act(w.manager, 'change_raiser', { ...revision(ticket), new_raiser: w.next.user, reason: 'x', ticket_state: 'Closed' }), /Unknown or protected/)
    await refused(change(w.manager, { ...ticket, updated_at: '2020-01-01T00:00:00.000Z' }, w.next.user), /reload/)
    // The ticket moved on after it was read.
    await act(w.raiser, 'edit', { ...revision(ticket), title: 'Plant address is still wrong' })
    await refused(change(w.manager, ticket, w.next.user), /reload/)
    expect((await stored(ticket.row_id)).owner).toBe(w.raiser.user)
    expect(await eventsOf(ticket.row_id)).toEqual([])
  })

  test('an idempotency key replays the first answer and writes one event; another payload under it is refused', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await w.raise()
    const key = randomUUID()
    const first = await change(w.manager, ticket, w.next.user, 'Bulk correction', key)
    expect(await change(w.manager, ticket, w.next.user, 'Bulk correction', key)).toEqual(first)
    expect(await eventsOf(ticket.row_id)).toHaveLength(1)
    await refused(change(w.manager, ticket, w.colleague.user, 'Bulk correction', key), /different payload/)
    expect((await stored(ticket.row_id)).owner).toBe(w.next.user)
  })

  test('the history reads by name, for someone who may not read Person too, and is seen by whoever sees other events', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await w.raise()
    await change(w.manager, ticket, w.next.user)
    for (const viewer of [w.colleague, w.support, w.next, w.raiser]) {
      const detail = await read(viewer, 'detail', { row_id: ticket.row_id })
      const event = detail.privateEvents.find((e: any) => e.operation === 'change_raiser')
      expect(event).toBeDefined()
      expect(detail.names).toMatchObject({ [w.raiser.user]: 'Raiser', [w.next.user]: 'Next Raiser', [w.manager.user]: 'Manager' })
    }
    const queue = await read(w.colleague, 'queue')
    expect(queue.names[w.next.user]).toBe('Next Raiser')
  })

  test('a private ticket: the event stays with support, and the raiser never sees it publicly', async ({ admin, createUser }) => {
    const w = await world(admin, createUser, 'private')
    const ticket = await w.raise()
    await change(w.manager, ticket, w.next.user, 'A private reason')
    expect(await eventsOf(ticket.row_id)).toEqual([])
    expect(await eventsOf(ticket.row_id, 'tickets.event')).toHaveLength(1)
    const detail = await read(w.support, 'detail', { row_id: ticket.row_id })
    expect(detail.privateEvents.some((e: any) => e.operation === 'change_raiser')).toBe(true)
    expect(detail.names).toMatchObject({ [w.raiser.user]: 'Raiser', [w.next.user]: 'Next Raiser' })
    for (const viewer of [w.next, w.raiser, w.colleague])
      expect(JSON.stringify(await read(viewer, 'detail', { row_id: ticket.row_id }))).not.toContain('A private reason')
  })

  for (const visibility of ['everyone', 'private'] as const)
    test(`${visibility}: the new raiser takes the raiser's steps and the old raiser no longer may`, async ({ admin, createUser }) => {
      const w = await world(admin, createUser, visibility)
      let ticket = await w.raise()
      await act(w.support, 'edit', { ...revision(ticket), assigned_to: w.support.user })
      ticket = (await read(w.support, 'detail', { row_id: ticket.row_id })).ticket
      ticket = (await act(w.support, 'transition', { ...revision(ticket), action: 'Ask a question', values: { question: 'Which plant?' } })).ticket
      const actionsOf = async (client: TestClient) => ((await read(client, 'detail', { row_id: ticket.row_id })).actions ?? []).map((a: any) => a.action)
      expect(await actionsOf(w.raiser)).toEqual(['Answer'])
      expect(await actionsOf(w.next)).toEqual([])
      ticket = (await change(w.manager, ticket, w.next.user)).ticket
      expect(await actionsOf(w.next)).toEqual(['Answer'])
      expect(await actionsOf(w.raiser)).toEqual([])
      await refused(act(w.raiser, 'transition', { ...revision(ticket), action: 'Answer', values: { answer: 'Plant 1100' } }), /not allowed/)
      // The step records its value in the request, which the new raiser may now write.
      const answered = (await act(w.next, 'transition', { ...revision(ticket), action: 'Answer', values: { answer: 'Plant 1100' } })).ticket
      expect(answered.ticket_state).toBe('Raised')
      expect((await read(w.next, 'detail', { row_id: ticket.row_id })).details).toMatchObject({ answer: 'Plant 1100', current_value: '78/499/1' })
    })

  test('a private ticket: the request moves to the new raiser, through the app and the generic API alike', async ({ admin, createUser }) => {
    const w = await world(admin, createUser, 'private')
    let ticket = await w.raise()
    const secret = '78/499/1'
    expect(JSON.stringify((await read(w.raiser, 'detail', { row_id: ticket.row_id })).details)).toContain(secret)
    ticket = (await change(w.manager, ticket, w.next.user)).ticket
    expect((await read(w.next, 'detail', { row_id: ticket.row_id })).details).toMatchObject({ current_value: secret })
    expect((await read(w.raiser, 'detail', { row_id: ticket.row_id })).details).toBeUndefined()
    expect((await w.next.get<any>(`/api/table/tickets.request/${ticket.row_id}`)).row_id).toBe(ticket.row_id)
    await refused(w.raiser.get(`/api/table/tickets.request/${ticket.row_id}`), undefined, [403, 404])
    const listed = await (await w.raiser.fetch('/api/table/tickets.request?limit_page_length=500')).text()
    expect(listed).not.toContain(secret)
    // The new raiser may edit their request; the old raiser may not.
    ticket = (await act(w.next, 'edit', { ...revision(ticket), original: 'Corrected wording' })).ticket
    await refused(act(w.raiser, 'edit', { ...revision(ticket), original: 'Mine again' }), /Not authorized/)
  })

  test('a ticket opened from private: its kept private copy moves too, so a later edit stays in step', async ({ admin, createUser }) => {
    const w = await world(admin, createUser, 'private')
    let ticket = await w.raise()
    const [type] = await sql`select row_id, updated_at from tickets.ticket_type where type_key = 'data_quality_issue'`
    await save(admin, 'tickets.ticket_type', { row_id: type.row_id, updated_at: type.updated_at, details_visible_to: 'everyone' })
    await act(w.support, 'open_details', { row_id: ticket.row_id })
    ticket = (await read(w.support, 'detail', { row_id: ticket.row_id })).ticket
    ticket = (await change(w.manager, ticket, w.next.user)).ticket
    const [kept] = await sql`select created_by from tickets.request where row_id = ${ticket.row_id}`
    expect(kept.created_by).toBe(w.next.user)
    await act(w.next, 'edit', { ...revision(ticket), original: 'Corrected wording' })
    const [after] = await sql`select original from tickets.request where row_id = ${ticket.row_id}`
    expect(after.original).toBe('Corrected wording')
  })

  test('every other write of the raiser is still refused', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const ticket = await w.raise()
    for (const client of [w.manager, w.support, w.raiser, admin])
      await refused(save(client, 'tickets.ticket', { ...revision(ticket), owner: w.next.user }), /Use an authorized Tickets action/)
    // Inside another action, the immutable rule holds: edit takes no raiser, in its fields or its details.
    await refused(act(w.manager, 'edit', { ...revision(ticket), owner: w.next.user }), /Unknown or protected/)
    const [request] = await sql`select updated_at from tickets.open_request where row_id = ${ticket.row_id}`
    await refused(save(w.manager, 'tickets.open_request', { row_id: ticket.row_id, updated_at: request.updated_at, original: 'x' }), /Use an authorized Tickets action/)
    expect((await stored(ticket.row_id)).owner).toBe(w.raiser.user)
  })

  test('the immutable rule lets only change_raiser through, whichever action writes', async () => {
    const app = await import(resolve(directory, 'dist/server.mjs'))
    const old = { row_id: 'FT-1', owner: 'psn_old', updated_at: 'r1', kind: 'generic', ticket_state: 'New', title: 't' }
    const rejectWith = (message: string): never => { throw new Error(message) }
    // A forged write from a handler that is not change_raiser: its save tries to change the raiser.
    const documents = {
      get: async () => old, list: async () => [], create: async () => ({ row_id: 'x' }),
      update: async (table: string, row: object) => {
        app.validators[table]({ row: { ...old, ...row, owner: 'psn_new' }, old, user: 'psn_actor', isNew: false, reject: rejectWith })
        return row
      },
    }
    const context = (operation: object) => ({ user: 'psn_actor', userName: 'Actor', roles: ['All', 'System Manager'],
      settings: { support_users: JSON.stringify(['psn_actor']) }, people: { names: async () => ({}), enabled: async () => [] }, reject: rejectWith, documents, ...operation })
    await expect(app.actions.note(context({ payload: { row_id: 'FT-1', updated_at: 'r1', text: 'hello' } }))).rejects.toThrow('The requester is immutable')
    expect(() => app.validators['tickets.ticket']({ row: { ...old, owner: 'psn_new' }, old, user: 'psn_actor', isNew: false, reject: rejectWith }))
      .toThrow('Use an authorized Tickets action')
  })

  test('Tickets upgrades from the version before this one with no schema or grant change', async ({ admin }) => {
    const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
    const step = manifest.migrations.find((m: any) => m.toVersion === version)
    expect(step).toMatchObject({ id: 'split_screens', operations: [] })
    const prior = await mkdtemp(resolve('test/.upgrade-tickets-'))
    try {
      await cp(directory, prior, { recursive: true, filter: source => !source.includes('node_modules') })
      // The same files at the earlier version: what this checks is the migration chain and the plan.
      await writeFile(resolve(prior, 'featherbase.json'), JSON.stringify({ ...manifest, migrations: manifest.migrations.filter((m: any) => m !== step) }))
      await writeFile(resolve(prior, 'package.json'), JSON.stringify({ ...JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')), version: step.fromVersion }))
      await discoverPackages([prior])
      await admin.post('/api/install_app', { name: 'tickets' })
      await discoverPackages([prior, directory])
      await loadInstalledApps()
      const plan = await admin.post<any>('/api/preview_app_upgrade', { name: 'tickets', version })
      expect(plan).toMatchObject({ currentVersion: step.fromVersion, targetVersion: version, codeOnly: true, permissions: [] })
      await admin.post('/api/upgrade_app', { name: 'tickets', version, planId: plan.planId })
      await admin.post('/api/activate_app_upgrade', { name: 'tickets', version })
      const [installed] = await sql`select package_version, activation_pending from installed_app where name = 'tickets'`
      expect(installed).toMatchObject({ package_version: version, activation_pending: false })
    } finally { await rm(prior, { recursive: true, force: true }) }
  })

  test('people.enabled answers enabled people only', async ({ admin, createUser }) => {
    const w = await world(admin, createUser)
    const left = await createUser({ email: 'left2@tickets.example.test', fullName: 'Has Left' }) as Person
    await sql`update person set enabled = false where row_id = ${left.user}`
    expect(await enabledPeople([w.next.user, left.user, 'psn_nope', 'Administrator'], w.manager.user)).toEqual([w.next.user])
    expect(await enabledPeople([], w.manager.user)).toEqual([])
    // Someone with no Person access is told nothing, and nothing breaks.
    expect(await enabledPeople([w.next.user, left.user], w.colleague.user)).toEqual([])
  })

  test('handOver is refused unless the caller is a System Manager and the Table is the app\'s own', async ({ admin, createUser }) => {
    const w = await world(admin, createUser, 'private')
    const ticket = await w.raise()
    const creator = async () => (await sql`select created_by from tickets.request where row_id = ${ticket.row_id}`)[0].created_by
    const asSupport = callerDocuments('tickets', ['tickets.request'], w.support.user).documents
    await expect(asSupport.handOver('tickets.request', ticket.row_id, w.next.user)).rejects.toMatchObject({ type: 'PermissionError' })
    expect(await creator()).toBe(w.raiser.user)
    const manager = () => callerDocuments('tickets', ['tickets.request', 'Example Elsewhere'], w.manager.user).documents
    await expect(manager().handOver('tickets.request', ticket.row_id, 'psn_nope')).rejects.toThrow(/enabled person/)
    await makeTable(admin, { name: 'Example Elsewhere', columns: ['label'] })
    const other = await save(admin, 'Example Elsewhere', { label: 'x' })
    await expect(manager().handOver('Example Elsewhere', other.row_id, w.next.user)).rejects.toThrow(/own/)
    await manager().handOver('tickets.request', ticket.row_id, w.next.user)
    expect(await creator()).toBe(w.next.user)
  })
})

// Assigned to no one, as a loader would raise it: the change must leave that alone.
async function raise_assigned(w: Awaited<ReturnType<typeof world>>) {
  const ticket = await w.raise()
  const updated = (await act(w.support, 'edit', { ...revision(ticket), assigned_to: w.support.user, public_update: 'Looking at it' })).ticket as Ticket
  return updated
}
