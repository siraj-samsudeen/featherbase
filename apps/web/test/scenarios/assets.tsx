// Assets (client-apps/jeyarama/equipment) as its spec scenarios meet it
// (#1070): installed afresh, its named people with their roles, setup rows
// saved by the System Manager, calls made as a person over HTTP, and its
// pages rendered in jsdom for whoever is looking. Steps never see a route or
// a selector they don't name.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { vi } from 'vitest'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { getDoc, saveDoc } from 'server/src/document'
import { issueSession } from 'server/src/auth'
import { sandboxRequest } from 'server/test/pg-test-shared'
import { sql } from 'server/src/db'
import { AssetsApp } from '../../../../client-apps/jeyarama/equipment/src/AssetsApp'
import { version } from '../../../../client-apps/jeyarama/equipment/package.json'
import { setSession } from '../../src/lib/api'
import { expect, insideOf, screenSession } from '../pg-test'

export type Row = { row_id: string; updated_at: string; [field: string]: unknown }
type CreateUser = (options: { roles: string[]; fullName: string }) => Promise<TestClient>
const ADMIN = 'Administrator'
const HOUR = 3_600_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Who is who in the Assets specs, and their Featherbase roles. */
const CAST: Record<string, string[]> = {
  'the user': ['Assets Manager'],
  'a manager': ['Assets Manager'],
  Meena: ['Assets Manager'],
  'the asset accountant': ['Assets Manager'],
  Ravi: ['Assets Technician'],
  Suresh: ['Assets Member'],
  'store staff': ['Assets Member'],
  'a member': ['Assets Member'],
  'another member': ['Assets Member'],
}

/** An instant as Assets writes it: "07-Nov-2026 10:00 IST". */
export function istLabel(value: string | number | Date) {
  const ist = new Date(new Date(value).getTime() + 5.5 * HOUR)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(ist.getUTCDate())}-${MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST`
}

/** Puts the clock back to real time (each scenario file does so after every test). */
export function realTime() { vi.useRealTimers() }

/** A client built with the Assets app: its Tables answer only one that names the installed version. */
function assetsClient(client: TestClient): TestClient {
  return makeClient({ request: (path, init) => client.fetch(String(path), {
    ...init,
    headers: { 'X-Featherbase-App-Version': `equipment@${version}`, ...init?.headers },
  }) }, client.token, client.user)
}

export class Assets {
  ids: Record<string, string> = {} // person name -> Person row_id
  names: Record<string, string> = {} // Person row_id -> person name
  places: Record<string, string> = {}
  types: Record<string, string> = {}
  entities: Record<string, string> = {}
  assets: Record<string, string> = {}
  /** The last call's { status, body }, for "it is refused". */
  last: { status: number; body: any } | null = null
  /** The roles of people the scenario names beyond the cast ('a counter'), and roles added since. */
  roles: Record<string, string[]> = {}
  private sessions = new Map<string, { clock: number | null; client: TestClient }>()
  private clock: number | null = null

  private constructor(private createUser: CreateUser) {}

  /** Assets installed afresh, with the System Manager admitted as an Assets Manager for setup. */
  static async start({ createUser, admin }: { createUser: CreateUser; admin: TestClient }) {
    expect(await discoverPackages([resolve('../..', 'client-apps/jeyarama/equipment')])).toEqual([])
    if (await isInstalled('equipment')) await uninstallApp('equipment')
    await installApp('equipment')
    const person = await getDoc('Person', ADMIN, ADMIN)
    await saveDoc('Person', { ...person, roles: [...person.roles as Record<string, unknown>[], { role: 'Assets Manager' }] }, ADMIN)
    const world = new Assets(createUser)
    world.sessions.set(ADMIN, { clock: null, client: assetsClient(admin) })
    return world
  }

  /** The clock the server and the pages read: this instant, standing still until moved. */
  setClock(instant: string | number | Date) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(instant))
    this.clock = new Date(instant).getTime()
  }

  /** A person of the scenario, made the first time they are named, with their full name. */
  async who(name: string) {
    if (this.ids[name]) return this.ids[name]
    const roles = this.roles[name] ?? CAST[name]
    if (!roles) throw new Error(`Assets has no one called "${name}"`)
    this.roles[name] = [...roles]
    const fullName = name.replace(/^(a|an|the|another) /, '').replace(/^\w/, c => c.toUpperCase())
    const client = assetsClient(await this.createUser({ roles, fullName }))
    this.ids[name] = client.user!
    this.names[client.user!] = fullName
    this.sessions.set(client.user!, { clock: this.clock, client })
    return client.user!
  }

  /** The API as this person (or the System Manager), signed in afresh whenever the clock has moved. */
  async client(name: string) { return this.session(name === ADMIN ? ADMIN : await this.who(name)) }
  private async session(person: string) {
    const known = this.sessions.get(person)
    if (known && known.clock === this.clock) return known.client
    const { token } = await issueSession(person)
    const client = assetsClient(makeClient({ request: sandboxRequest }, token, person))
    this.sessions.set(person, { clock: this.clock, client })
    return client
  }

  /** Any call as a named person: { status, body }. */
  async call(name: string, path: string, data?: unknown, method = 'POST') {
    const res = await (await this.client(name)).fetch(path, { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    const text = await res.text()
    let body: any
    try { body = JSON.parse(text) } catch { body = text }
    this.last = { status: res.status, body }
    return this.last
  }

  /** Saves a row as a person. With attempt, a refusal is kept in `last` instead of failing. */
  async save(name: string, table: string, row: Record<string, unknown>, attempt = false) {
    const response = await this.call(name, '/api/save_row', { table, row })
    if (!attempt) expect(response.status, `${table}: ${JSON.stringify(response.body)}`).toBe(201)
    return response.body as Row
  }

  /** Saves changes to an existing row as a person, from its current version. */
  async change(name: string, table: string, id: string, values: Record<string, unknown>, attempt = false) {
    const current = await this.get(table, id)
    return this.save(name, table, { row_id: id, updated_at: current.updated_at, ...values }, attempt)
  }

  /** Runs an Assets action as a person. */
  async act(name: string, action: string, payload: unknown, attempt = false) {
    const response = await this.call(name, `/api/app_actions/equipment/${action}`, { idempotencyKey: randomUUID(), payload })
    if (!attempt) expect(response.status, `${action}: ${JSON.stringify(response.body)}`).toBe(200)
    return response.body?.result
  }

  /** A row as stored, read as the System Manager. */
  async get(table: string, id: string) {
    return (await this.client(ADMIN)).get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}`)
  }

  /** Rows of a table matching filters, read as the System Manager. */
  async list(table: string, filters: unknown[] = [], fields = ['row_id']) {
    const query = `filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}&limit_page_length=500`
    return (await (await this.client(ADMIN)).get<{ data: Row[] }>(`/api/table/${encodeURIComponent(table)}?${query}`)).data
  }

  /** A row saved by the System Manager for setup. */
  async setupRow(table: string, row: Record<string, unknown>) {
    return (await this.client(ADMIN)).post<Row>('/api/save_row', { table, row })
  }

  /** The last call was refused, with a message matching `pattern` when given. */
  refused(pattern?: RegExp) {
    expect(this.last, 'nothing was tried').not.toBeNull()
    expect(this.last!.status >= 400 && this.last!.status < 500, `expected a refusal, got ${this.last!.status}: ${JSON.stringify(this.last!.body)}`).toBe(true)
    if (pattern) expect(JSON.stringify(this.last!.body)).toMatch(pattern)
  }

  /** A person the shared cast has no name for ('the site manager'), made like the cast's people. */
  extra(name: string, roles: string[]) {
    this.roles[name] ??= roles
    return this.who(name)
  }

  /** Gives a person of the scenario one more Featherbase role. */
  async addRole(name: string, role: string) {
    const id = await this.who(name)
    const person = await this.get('Person', id)
    const roles = person.roles as { role: string }[]
    if (roles.some(entry => entry.role === role)) return
    await this.setupRow('Person', { row_id: id, updated_at: person.updated_at, roles: [...roles, { role }] })
    this.roles[name] = [...this.roles[name]!, role]
  }

  // ---- The pilot's places, types, legal entities and assets ----

  /** A place; `parent` names the place it sits in. */
  async place(name: string, level = 'Site', parent: string | null = null, extra: Record<string, unknown> = {}) {
    this.places[name] ??= (await this.setupRow('equipment.place',
      { place_name: name, place_level: level, ...(parent ? { parent_place: await this.place(parent) } : {}), ...extra })).row_id
    return this.places[name]
  }

  async type(name: string) {
    this.types[name] ??= (await this.setupRow('equipment.asset_type', { type_name: name })).row_id
    return this.types[name]
  }

  async entity(shortName: string, status = 'Verified') {
    this.entities[shortName] ??= (await this.setupRow('equipment.entity', { entity_name: shortName, short_name: shortName, entity_status: status })).row_id
    return this.entities[shortName]
  }

  /** An asset in the register, made once by name. */
  async asset(name: string, place = 'ATK 1501', extra: Record<string, unknown> = {}) {
    if (this.assets[name]) return this.assets[name]
    const { type = 'Other', ...values } = extra
    const row = await this.setupRow('equipment.asset', { asset_name: name, asset_type: await this.type(String(type)), place: await this.place(place), ...values })
    this.assets[name] = row.row_id
    return row.row_id
  }

  // ---- Pages, as a person sees them ----

  /** Opens an Assets page (a hash route such as `asset=AST-0001` or `custody`) as this person; returns its main. */
  async open(name: string, route: string) {
    const client = await this.client(name)
    cleanup()
    setSession(client.token!, { row_id: client.user!, email: client.user!, full_name: null })
    location.hash = `#${route}`
    const roles = name === ADMIN ? ['System Manager', 'Assets Manager'] : this.roles[name]!
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AssetsApp roles={roles} />
    </QueryClientProvider>)
    return document.querySelector('main') as HTMLElement
  }

  /** Moves the open page to another route, as a link would. */
  go(route: string) {
    location.hash = `#${route}`
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  main() { return screen.getByRole('main') }
}

const short = () => randomUUID().slice(0, 8)

/**
 * Counts and the ATK fresh count, on top of the Assets world: the scenario's
 * sites and areas, its count, its counters and reviewer, and what they record.
 */
export class AssetCounts {
  /** The scenario's count row. */
  count: Row = null as unknown as Row
  private nextTag = 300001

  constructor(readonly assets: Assets) {}

  /** Names a person as the pilot's asset accountant or finance controller. */
  async financeRole(name: string, financeRole: string) {
    await this.assets.setupRow('equipment.finance_person', { person: await this.assets.who(name), finance_role: financeRole })
  }

  site(name = 'ATK 1501', extra: Record<string, unknown> = {}) {
    return this.assets.place(name, 'Site', null, extra)
  }

  async area(name: string, site = 'ATK 1501') {
    await this.site(site)
    return this.assets.place(name, 'Area', site)
  }

  /** Makes a place's site manager a named person. */
  async siteManager(name: string, site = 'ATK 1501') {
    const id = await this.site(site)
    const place = await this.assets.get('equipment.place', id)
    await this.assets.setupRow('equipment.place', { row_id: id, updated_at: place.updated_at, site_manager: await this.assets.who(name) })
  }

  /** A manager plans a count of a site, with its counters and reviewer. */
  async plan({ kind = 'Full', site = 'ATK 1501', counters = ['Suresh'], reviewer = 'Meena', by = 'a manager', extra = {} }:
    { kind?: string; site?: string; counters?: string[]; reviewer?: string; by?: string; extra?: Record<string, unknown> } = {}) {
    this.count = await this.assets.save(by, 'equipment.count', {
      count_name: `ATK count ${short()}`, scope_place: await this.site(site), count_kind: kind, reviewer: await this.assets.who(reviewer), ...extra,
    })
    for (const counter of counters) await this.addCounter(by, counter)
    return this.count
  }

  async addCounter(by: string, name: string, attempt = false) {
    return this.assets.save(by, 'equipment.counter', { count: this.count.row_id, person: await this.assets.who(name) }, attempt)
  }

  current() { return this.assets.get('equipment.count', this.count.row_id) }

  async start(by = 'a manager') {
    const current = await this.current()
    return this.assets.act(by, 'start_count', { row_id: current.row_id, updated_at: current.updated_at })
  }

  async moveTo(stage: string, by = 'a manager', attempt = false) {
    const current = await this.current()
    return this.assets.save(by, 'equipment.count', { row_id: current.row_id, updated_at: current.updated_at, count_state: stage }, attempt)
  }

  /** The asset IDs fixed as expected when the count started, as an Assets Manager reads them. */
  async expected() {
    return (await this.assets.list('equipment.count_expected', [['count', '=', this.count.row_id]], ['asset'])).map(row => row.asset)
  }

  /** Asks for the count's expected list as a person; the answer is kept for `refused`. */
  askExpected(name: string) {
    const filters = encodeURIComponent(JSON.stringify([['count', '=', this.count.row_id]]))
    return this.assets.call(name, `/api/table/equipment.count_expected?filters=${filters}&fields=["asset"]`, undefined, 'GET')
  }

  /** A counter records an item of the register in an area. */
  record(name: string, { asset, area, outcome = 'Found here', ...rest }: { asset?: string; area: string; outcome?: string; [field: string]: unknown }, attempt = false) {
    return this.assets.save(name, 'equipment.scan', {
      count: this.count.row_id, ...(asset ? { asset: this.assets.assets[asset] } : {}), area: this.assets.places[area], outcome, ...rest,
    }, attempt)
  }

  /** A counter types an asset's tag by hand. */
  typeTag(name: string, asset: string, area: string, reason: string | null, attempt = false) {
    return this.assets.save(name, 'equipment.scan', {
      count: this.count.row_id, typed_tag: this.assets.assets[asset], area: this.assets.places[area], outcome: 'Found here', ...(reason ? { reason } : {}),
    }, attempt)
  }

  scans() {
    return this.assets.list('equipment.scan', [['count', '=', this.count.row_id]], ['row_id', 'asset', 'outcome', 'area', 'duplicate', 'created_by', 'created_at'])
  }

  /** The reviewer decides a missing asset's line. */
  decide(name: string, asset: string, decision: string) {
    return this.assets.save(name, 'equipment.count_decision', { count: this.count.row_id, asset: this.assets.assets[asset], decision })
  }

  /** Moves a recorded scan back to a past moment: the platform stamps records with the database's clock. */
  async backdate(scanId: string, instant: string) {
    const [table] = await sql`
      select table_schema as schema, table_name as name from information_schema.columns
       where column_name = 'typed_tag' and table_name in (select table_name from information_schema.columns where column_name = 'new_tag')` as unknown as { schema: string; name: string }[]
    expect(table, 'no table holds count records').toBeTruthy()
    const updated = await sql.unsafe(`update "${table!.schema}"."${table!.name}" set created_at = $1 where row_id = $2 returning row_id`, [instant, scanId])
    expect(updated, `record ${scanId} was not found`).toHaveLength(1)
  }

  // ---- Pages ----

  /** The Counts list, as a person sees it: the row of this scenario's count. */
  async countsRow(name: string) {
    await this.assets.open(name, 'counts')
    const table = await screen.findByRole('table', { name: 'Counts' })
    // The count's row, found by its name, and whether it offers a button: the DSL reads neither.
    const row = await waitFor(() => {
      const found = within(table).getAllByRole('row').find(r => r.textContent!.includes(String(this.count.count_name)))
      expect(found, 'the count is listed').toBeTruthy()
      return found!
    })
    return { text: row.textContent!, canStart: Boolean(within(row).queryByRole('button', { name: 'Start count' })) }
  }

  /** Picks an area on the open count page; the areas offered, once the page has them. */
  private async chooseArea(areaName: string) {
    // The areas offered, read whole: an area is named by its path, which ends in the area's own name.
    const select = await screen.findByRole('combobox', { name: 'Area' }) as HTMLSelectElement
    const areas = await waitFor(() => {
      const labels = [...select.options].map(o => o.textContent!).filter(label => label !== 'Choose where you are')
      expect(labels.find(label => label.endsWith(areaName)), `${areaName} is not offered: ${labels.join(', ')}`).toBeTruthy()
      return labels
    })
    await screenSession().selectOption('Area', areas.find(label => label.endsWith(areaName))!.trim())
    return areas
  }

  /** A counter's count page, with an area chosen: the areas offered, and the page's text. */
  async counterPage(name: string, areaName: string) {
    const main = await this.assets.open(name, `count=${encodeURIComponent(this.count.row_id)}`)
    const areas = await this.chooseArea(areaName)
    await insideOf(screenSession(), 'p.count-progress', (progress) => progress.assertText('You have recorded'))
    return { areas, text: main.textContent! }
  }

  /** The reviewer's page, opened: the text under each heading. */
  async review(name: string) {
    await this.assets.open(name, `review=${encodeURIComponent(this.count.row_id)}`)
    await screen.findByRole('table', { name: 'Outcomes' })
    return this.reviewShown()
  }

  /** The open review page's text under each heading, as it reads now, for patterns: the DSL's text verbs match literal text only. */
  reviewShown() {
    const section = (heading: string) => screen.getByRole('heading', { name: heading }).closest('section')!.textContent!
    return { missing: section('Missing'), moved: section('Moved since the start'), found: section('Found') }
  }

  // ---- Fresh counts and tags ----

  /** A tag that is on an issued roll; a roll of its own number when no roll holds it. */
  async issuedTag(number: number) {
    const rolls = await this.assets.list('equipment.tag_roll', [], ['first_no', 'last_no'])
    if (!rolls.some(roll => Number(roll.first_no) <= number && number <= Number(roll.last_no)))
      await this.assets.setupRow('equipment.tag_roll', { roll_name: `Roll ${number}`, first_no: number, last_no: number })
    return `JRA-${String(number).padStart(6, '0')}`
  }

  /** An issued tag nothing carries yet. */
  freshTag() { return this.issuedTag(this.nextTag++) }

  /** A manager plans and starts a fresh inventory count of a site with its two-person team. */
  async freshCount(team: string[], site = 'ATK 1501') {
    await this.plan({ kind: 'Fresh inventory', site, counters: team, reviewer: 'a manager' })
    await this.start()
    return this.count
  }

  /** One count sheet line, recorded by one team member and initialled by the other. */
  async line(name: string, { tag, taggedBy, area, ...rest }: { tag: string; taggedBy: string; area: string; [field: string]: unknown }, attempt = false) {
    return this.assets.save(name, 'equipment.count_line', {
      count: this.count.row_id, place: this.assets.places[area], asset_type: await this.assets.type('Display chiller'), asset_name: '3-door upright chiller',
      tag_status: 'Tagged', tag_no: tag, ownership: 'Group owned', condition: 'Working', usage: 'In use', tagged_by: await this.assets.who(taggedBy), ...rest,
    }, attempt)
  }

  /** The lines table of one area of the fresh count, as a person sees it. */
  async freshLines(name: string, areaName: string) {
    await this.assets.open(name, `count=${encodeURIComponent(this.count.row_id)}`)
    await this.chooseArea(areaName)
    const table = await screen.findByRole('table', { name: 'Count lines' })
    // The table's rows, for its callers to read: the DSL reads text, not rows.
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(1))
    return table
  }
}
