// Assets (client-apps/jeyarama/equipment) as its spec scenarios meet it
// (#1070): installed afresh, its named people with their roles, setup rows
// saved by the System Manager, calls made as a person over HTTP, and its
// pages rendered in jsdom for whoever is looking. Steps never see a route or
// a selector they don't name.
import { cleanup, render, screen } from '@testing-library/react'
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
import { AssetsApp } from '../../../../client-apps/jeyarama/equipment/src/AssetsApp'
import { version } from '../../../../client-apps/jeyarama/equipment/package.json'
import { setSession } from '../../src/lib/api'
import { expect } from '../pg-test'

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
    const roles = CAST[name]
    if (!roles) throw new Error(`Assets has no one called "${name}"`)
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
    const roles = name === ADMIN ? ['System Manager', 'Assets Manager'] : CAST[name]!
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
