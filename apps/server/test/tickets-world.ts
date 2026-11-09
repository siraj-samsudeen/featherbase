// The Tickets app as its spec scenarios meet it (#1070): one installed
// Tickets, the people the scenarios name (Anjali, Colleague, Support,
// Verifier, Bala, Karthik, Shiva, Fulfiller) and the configuration they
// assume, driven through Tickets' own actions and reads over HTTP. It is the
// Vitest form of the cucumber flow objects acceptance-tests/support/pages/
// tickets.js and ticket-transitions.js, so the scenario tests in
// apps/server/test/scenarios/ and apps/web/test/scenarios/ arrange the same
// world and assert the same things.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { discoverPackages } from '../src/runtime-packages'
import { grantRole, makeTable } from './fixtures'

export const TICKETS_DIRECTORY = resolve('../..', 'example-apps/tickets')
export const TICKETS_VERSION = (JSON.parse(readFileSync(resolve(TICKETS_DIRECTORY, 'package.json'), 'utf8')) as { version: string }).version

/** A client that names the installed Tickets version, as Tickets' own page does. */
export const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...(init?.headers as Record<string, string>), 'X-Featherbase-App-Version': `tickets@${TICKETS_VERSION}` },
}) }, client.token, client.user)

type Fixtures = { admin: TestClient; createUser: CreateUserFn }
/** Fixture overrides for `test.extend(...)`: every client names the Tickets version. */
export const pinning = {
  admin: async ({ admin }: { admin: TestClient }, use: (client: TestClient) => Promise<void>) => use(pinned(admin)),
  createUser: async ({ createUser }: { createUser: CreateUserFn }, use: (create: CreateUserFn) => Promise<void>) =>
    use(async options => pinned(await createUser(options))),
}
export type TicketsFixtures = Fixtures

export type Reply = { status: number; body: any }
export type Ticket = { row_id: string; updated_at: string; ticket_state: string; assigned_to?: string | null; owner: string; [key: string]: any }

const STAFF = ['Support', 'Verifier', 'Bala', 'Karthik', 'Shiva', 'Fulfiller']
const REQUESTERS = ['Anjali', 'Colleague']
/** The platform's Administrator, who installs and configures Tickets, may act too. */
export const ADMINISTRATOR = 'Administrator'

export class Tickets {
  people: Record<string, TestClient> = {}
  ids: Record<string, string> = {}
  roles: Record<string, string[]> = {}
  actor = 'Support'
  details: Record<string, unknown> = {}
  original = ''
  ticket!: Ticket
  last: Reply = { status: 0, body: null }
  private ready = false

  constructor(readonly admin: TestClient, readonly createUser: CreateUserFn) {
    this.people[ADMINISTRATOR] = admin
    this.ids[ADMINISTRATOR] = admin.user!
  }

  /** A person of the scenario, created once, named by their part. */
  async person(name: string, roles: string[]) {
    if (this.people[name]) return this.people[name]
    const client = await this.createUser({ email: `${name.toLowerCase().replace(/\W+/g, '-')}@people.example.test`, fullName: name, roles })
    this.people[name] = client
    this.ids[name] = client.user!
    this.roles[name] = roles
    return client
  }

  async setup() {
    if (this.ready) return
    expect(await discoverPackages([TICKETS_DIRECTORY])).toEqual([])
    await this.admin.post('/api/install_app', { name: 'tickets' })
    for (const name of [...REQUESTERS, ...STAFF]) await this.person(name, STAFF.includes(name) ? ['Tickets Support'] : ['All'])
    await this.configure({
      support_users: STAFF.map(name => this.ids[name]),
      verification_admins: [this.ids.Verifier], fulfillment_admins: [this.ids.Fulfiller],
      approval_routes: { Kerala: [this.ids.Bala], Chennai: [this.ids.Karthik, this.ids.Shiva] }, restricted_resources: ['Bronze'],
    })
    this.ready = true
  }

  /** Tickets' settings, written as ordinary App Setting rows (there is no other API). */
  async configure(values: Record<string, unknown>) {
    for (const [name, value] of Object.entries(values)) {
      const filters = encodeURIComponent(JSON.stringify([['row_id', '=', `tickets.${name}`]]))
      const current = (await this.admin.get<any>(`/api/table/App%20Setting?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`)).data[0]
      await this.admin.post('/api/save_row', { table: 'App Setting', row: { row_id: `tickets.${name}`, updated_at: current?.updated_at, value: JSON.stringify(value) } })
    }
  }

  /** One HTTP request as that person: the status and body, refused or not. */
  async call(actor: string, path: string, data?: unknown, method = 'POST'): Promise<Reply> {
    const client = this.people[actor]
    if (!client) throw new Error(`no one called "${actor}" in this scenario`)
    const response = await client.fetch(path, { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    const text = await response.text()
    let body: any
    try { body = JSON.parse(text) } catch { body = text }
    return { status: response.status, body }
  }

  revision() { return { row_id: this.ticket.row_id, updated_at: this.ticket.updated_at } }

  /** A Tickets action; unless `attempt`, it must succeed. The saved ticket becomes the current one. */
  async action(name: string, payload: Record<string, unknown> = {}, actor = this.actor, attempt = false) {
    const response = await this.call(actor, `/api/app_actions/tickets/${name}`, {
      idempotencyKey: randomUUID(), payload: { ...(name === 'create' ? {} : this.revision()), ...payload },
    })
    this.last = response
    if (!attempt) expect(response.status, JSON.stringify(response.body)).toBe(200)
    if (response.status === 200 && response.body.result.ticket) this.ticket = response.body.result.ticket
    return response
  }

  async read(name: string, payload: object = {}, actor = this.actor) {
    const response = await this.call(actor, `/api/app_reads/tickets/${name}`, { payload })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return response.body.result.answer
  }
  open(actor = this.actor) { return this.read('detail', { row_id: this.ticket.row_id }, actor) }
  async text(actor = this.actor) { return JSON.stringify(await this.open(actor)) }
  async choose(name: string) { await this.setup(); this.actor = name }

  async create(kind = 'access', details: Record<string, unknown> = {}, original = 'Please give me MotherDuck access') {
    await this.setup()
    this.details = kind === 'access' ? { email: 'anjali@example.com', scope: 'Gold sales, read only', ...details } : details
    this.original = original
    await this.action('create', { title: original, original, kind, details: this.details }, 'Anjali')
  }
  access(email = 'anjali@example.com', scope = 'Gold sales, read only') { return this.create('access', { email, scope }) }
  async verified(active = true, region = 'Kerala') {
    if (!this.ticket) await this.access()
    await this.action('verify', { email: this.details.email, active, region, evidence: 'Fictional HR confirmation 2026-11-03' }, 'Verifier')
  }
  async approved(scope = 'Gold sales, read only', region = 'Kerala') {
    await this.access('anjali@example.com', scope)
    await this.verified(true, region)
    await this.action('decide', { decision: 'approved' }, region === 'Kerala' ? 'Bala' : 'Shiva')
  }
  complaint(original = 'Invoices cleared two days ago are missing from the report') { return this.create('freshness', { complaint: original }, original) }
  finding() {
    return this.action('evidence', { expected: '2 invoices from source-check-1', observed: '0 from report-check-1',
      reference: 'source-check-1; report-check-1', observed_at: '2026-11-03T09:00:00Z', finding: 'confirmed_mismatch' }, 'Support')
  }
  async resolved() { await this.complaint(); await this.finding(); await this.action('resolve', { reason: 'Report refreshed and both invoices present', reference: 'report-check-2' }, 'Support') }
  async progress(employee = false) {
    await this.access()
    if (employee) await this.verified()
    await this.action('note', { text: 'PRIVATE support note 431' }, 'Support')
    await this.action('edit', { public_update: 'Support is checking this request' }, 'Support')
  }
  changeDetails(patch: Record<string, unknown>) {
    this.details = { ...this.details, ...patch }
    return this.action('edit', { details: this.details })
  }

  /** A change of raiser (#963), by 'Manager' (a System Manager) or anyone else; refused or not. */
  async changeRaiser(actor: string, person: string, reason: string) {
    if (actor === 'Manager') await this.person('Manager', ['System Manager'])
    return this.action('change_raiser', { new_raiser: this.ids[person], reason }, actor, true)
  }

  // ---- what the scenarios check ----

  denied() { expect([403, 409, 417], JSON.stringify(this.last)).toContain(this.last.status) }
  async includes(...values: string[]) { const text = await this.text(); for (const value of values) expect(text, `missing ${value}`).toContain(value) }
  async excludes(...values: string[]) { const text = await this.text(); for (const value of values) expect(text, `leaked ${value}`).not.toContain(value) }
  async unfulfilled() { expect((await this.open()).ticket.ticket_state).not.toBe('Resolved') }
  async cannotFulfill() { await this.action('fulfill', { reference: 'Stale or unauthorized completion' }, 'Fulfiller', true); this.denied(); await this.unfulfilled() }
  /** Bala's approval is refused: the request cannot be approved as it stands. */
  async cannotApprove() { await this.action('decide', { decision: 'approved' }, 'Bala', true); this.denied() }
}

// ---- configured ticket types (#912) and their transitions (#918) ----

export const plan = { fix_what: 'Door number in the plant address', fix_where: 'SAP plant master', target_date: '2026-11-10' }
const transitions = [
  { state: 'Raised', action: 'Confirm', next_state: 'Fix planned', allowed: 'assignee', fields: ['fix_what', 'fix_where', 'target_date'] },
  { state: 'Raised', action: 'Ask a question', next_state: 'Waiting for raiser', allowed: 'assignee', fields: ['question'] },
  { state: 'Waiting for raiser', action: 'Answer', next_state: 'Raised', allowed: 'requester', fields: ['answer'] },
  { state: 'Raised', action: 'Reject', next_state: 'Rejected', allowed: 'assignee', fields: ['rejection_reason'] },
  { state: 'Rejected', action: 'Reopen', next_state: 'Raised', allowed: 'requester' },
  { state: 'Fix planned', action: 'Mark fixed', next_state: 'Fixed: to verify', allowed: 'assignee', fields: ['what_changed'] },
  { state: 'Fixed: to verify', action: 'Verify', next_state: 'Closed', allowed: 'requester' },
  { state: 'Fixed: to verify', action: 'Verify', next_state: 'Closed', allowed: 'Data Quality Verifier' },
  { state: 'Fixed: to verify', action: 'Not fixed', next_state: 'Fix planned', allowed: 'requester', fields: ['still_wrong'] },
]
const actionFields = [
  ['fix_what', 'What will be fixed', 'long text'], ['fix_where', 'Where it will be fixed', 'text'], ['target_date', 'Target date', 'date'],
  ['question', 'Question', 'long text'], ['answer', 'Answer', 'long text'], ['rejection_reason', 'Why it is rejected', 'long text'],
  ['what_changed', 'What was changed', 'long text'], ['still_wrong', 'What is still wrong', 'long text'],
]

/** A "Data Quality Issue" type a System Manager configured as rows, never code. */
export class TicketTypes {
  key = 'dq_issue'
  systemsTable = 'Source System'
  ownersTable = 'System Owner'
  systems: Record<string, string> = {}
  fields: Record<string, { row_id: string; updated_at: string }> = {}
  type!: { row_id: string; updated_at: string }
  outsiderId = ''
  outsiderName = 'Outside Owner'
  private configured = false
  private readerRole = false
  constructor(readonly t: Tickets) {}

  private save(table: string, row: object) { return this.t.admin.post<any>('/api/save_row', { table, row }) }

  async configure({ readers = 'All' }: { readers?: string } = {}) {
    await this.t.setup()
    if (this.configured) return
    this.configured = true
    const admin = this.t.admin
    await makeTable(admin, { name: this.systemsTable, title_column: 'source_system', columns: [{ column_name: 'source_system', column_type: 'Data', reqd: true }] })
    await makeTable(admin, { name: this.ownersTable, columns: [
      { column_name: 'source_system', column_type: 'Reference', reference_table: this.systemsTable },
      { column_name: 'person', column_type: 'Data' }, { column_name: 'is_primary', column_type: 'Check' }] })
    await grantRole(admin, { role: readers, table: [this.systemsTable, this.ownersTable], can_read: true })
    for (const name of ['SAP', 'StyleHR']) this.systems[name] = (await this.save(this.systemsTable, { source_system: name })).row_id
    await this.save(this.ownersTable, { source_system: this.systems.SAP, person: this.t.ids.Bala, is_primary: true })
    await this.t.configure({ linked_tables: [this.systemsTable, this.ownersTable] })
    this.type = await this.save('tickets.ticket_type', { type_key: this.key, label: 'Data Quality Issue', enabled: true,
      states: ['Open', 'In progress', 'Fixed in source', 'Answered', 'Reopened'].join('\n'), done_states: 'Fixed in source\nAnswered', reopen_state: 'Reopened', details_visible_to: 'private',
      routing: JSON.stringify({ field: 'source_system', table: this.ownersTable, match: 'source_system', person: 'person', primary: 'is_primary' }) })
    const fields = [
      { field_name: 'source_system', label: 'Source system', field_type: 'link', link_table: this.systemsTable, link_label: 'source_system' },
      { field_name: 'also_concerns', label: 'Also concerns', field_type: 'link', link_table: this.systemsTable, link_label: 'source_system' },
      { field_name: 'current_value', label: 'Current value', field_type: 'long text' },
      { field_name: 'urgency', label: 'Urgency', field_type: 'choice', choices: 'Now\nLater', required: true },
      { field_name: 'raised_on', label: 'Raised on', field_type: 'date' },
      { field_name: 'raised_for', label: 'Raised for', field_type: 'person' },
    ]
    let order = 0
    for (const field of fields) this.fields[field.field_name] = await this.save('tickets.type_field', { ticket_type: this.type.row_id, field_order: ++order, ...field })
  }

  async removeField(name: string) {
    const field = this.fields[name]
    await this.t.admin.delete(`/api/table/tickets.type_field/${field.row_id}?updated_at=${encodeURIComponent(field.updated_at)}`)
  }

  async submit(details: Record<string, unknown> = {}, actor = 'Anjali', attempt = false) {
    await this.configure()
    return this.t.action('create', { title: 'Plant address is wrong', original: 'Two plants carry both door numbers', kind: this.key, details }, actor, attempt)
  }

  /** A person who may read Person (the Tickets Person Reader role). */
  async reader(name: string) {
    if (!this.readerRole) await grantRole(this.t.admin, { role: 'Tickets Person Reader', table: 'Person', can_read: true })
    this.readerRole = true
    await this.t.person(name, ['All', 'Tickets Person Reader'])
  }

  /** Someone who never used Tickets, with a full name of their own. */
  async outsider() {
    await this.t.person('Outsider', ['All'])
    this.outsiderId = this.t.ids.Outsider
    const current = await this.t.admin.get<{ updated_at: string }>(`/api/table/Person/${this.outsiderId}`)
    await this.save('Person', { row_id: this.outsiderId, updated_at: current.updated_at, full_name: this.outsiderName })
  }
}

/** The Data Quality Issue type whose actions say who moves a ticket and what they record. */
export class TicketTransitions {
  readonly types: TicketTypes
  private = false
  private configured = false
  constructor(readonly t: Tickets) { this.types = new TicketTypes(t) }

  async configure() {
    if (this.configured) return
    await this.types.configure()
    const admin = this.t.admin
    const type = await admin.get<Record<string, unknown>>(`/api/table/tickets.ticket_type/${this.types.type.row_id}`)
    await admin.post('/api/save_row', { table: 'tickets.ticket_type', row: { ...type, states: ['Raised', 'Waiting for raiser', 'Fix planned', 'Fixed: to verify', 'Closed', 'Rejected'].join('\n'),
      done_states: 'Closed\nRejected', reopen_state: '', transitions: JSON.stringify(transitions),
      details_visible_to: this.private ? 'private' : 'everyone' } })
    let order = 100
    for (const [field_name, label, field_type] of actionFields)
      await admin.post('/api/save_row', { table: 'tickets.type_field', row: { ticket_type: this.types.type.row_id, field_order: ++order, field_name, label, field_type } })
    this.configured = true
  }
  async raise() {
    await this.configure()
    await this.types.submit({ urgency: 'Now', source_system: this.types.systems.SAP, current_value: '78/499/1' })
    expect(this.t.ticket.assigned_to).toBe(this.t.ids.Bala)
  }
  take(actor: string, action: string, values?: Record<string, unknown>, attempt = false) {
    return this.t.action('transition', { action, ...(values ? { values } : {}) }, actor, attempt)
  }
  async offered(actor: string): Promise<string[]> { return ((await this.t.open(actor)).actions ?? []).map((a: { action: string }) => a.action) }
  async markedFixed() {
    await this.raise()
    await this.take('Bala', 'Confirm', plan)
    await this.take('Bala', 'Mark fixed', { what_changed: 'Corrected the door number for plant 1100' })
  }
  async roleHolder() {
    // The role alone: holding it grants nothing but the transition that names it.
    await grantRole(this.t.admin, { role: 'Data Quality Verifier', table: [] })
    await this.t.person('DQ Verifier', ['All', 'Data Quality Verifier'])
  }
}
