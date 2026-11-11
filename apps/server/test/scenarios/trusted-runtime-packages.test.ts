// trusted-runtime-packages' scenarios the server proves (#1070): what it
// serves for an installed app, what it refuses to install, and the Tickets
// package's guarantees through its actions and reads. Each test is one fenced
// scenario of the effective spec (openspec/specs/trusted-runtime-packages and
// the active change feather-tickets-stage-one), step by step; what a person
// sees in the shared bar is in apps/web/test/scenarios/.
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, vi } from 'vitest'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { APP_ACCENTS } from 'shared'
import { loadInstalledApps, setAppEnabled } from '../../src/apps'
import { sql } from '../../src/db'
import { app as server } from '../../src/index'
import { artifactDigest, discoverPackages, repinToFolder, shippedDigest } from '../../src/runtime-packages'
import { appLibraryPaths } from '../../src/app-library'
import { appPathsFromEnvironment } from '../../src/app-delivery'
import { expectRefused, expectStatus, grantRole, makeTable } from '../fixtures'
import { test as pgTest } from '../pg-test'
import { scenarioFor } from '../scenario'
import { admitTasker } from '../tasker-client'

const REPO = resolve(__dirname, '../../../..')
const TASKER = join(REPO, 'example-apps/tasker')
const TICKETS = join(REPO, 'example-apps/tickets')
const PLUM = join(REPO, 'test-apps/fixtures/plum-accent')
const OTHER = join(REPO, 'test-apps/other')
const TICKETS_VERSION = (JSON.parse(await readFile(join(TICKETS, 'package.json'), 'utf8')) as { version: string }).version

// Tickets records an upgrade step: its Tables and actions answer only a client
// that names the installed version, as its own page does.
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': `tickets@${TICKETS_VERSION}` },
}) }, client.token, client.user)
const test = pgTest.extend<{ tickets: TestClient; people: CreateUserFn }>({
  tickets: async ({ admin }, use) => use(pinned(admin)),
  people: async ({ createUser }, use) => use(async (options) => pinned(await createUser(options))),
})
const scenario = scenarioFor(test, 'trusted-runtime-packages')

type Ticket = { row_id: string; updated_at: string; ticket_state: string; owner: string; [key: string]: any }
const act = async (client: TestClient, name: string, payload: object) =>
  (await client.post<any>(`/api/app_actions/tickets/${name}`, { idempotencyKey: randomUUID(), payload })).result
const read = async (client: TestClient, name: string, payload: object = {}) =>
  (await client.post<any>(`/api/app_reads/tickets/${name}`, { payload })).result.answer
const revision = (ticket: Ticket) => ({ row_id: ticket.row_id, updated_at: ticket.updated_at })
const detail = (client: TestClient, ticket: Ticket) => read(client, 'detail', { row_id: ticket.row_id })
const save = (admin: TestClient, table: string, row: object) => admin.post<any>('/api/save_row', { table, row })

/** The request's answer, refused or not, as the browser receives it. */
async function attempt(promise: Promise<Response>) {
  const res = await promise
  const text = await res.text()
  let body: any
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const refused = (status: number) => expect([403, 409, 417]).toContain(status)

async function setting(admin: TestClient, name: string, value: unknown) {
  const filters = encodeURIComponent(JSON.stringify([['row_id', '=', `tickets.${name}`]]))
  const current = (await admin.get<any>(`/api/table/App%20Setting?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`)).data[0]
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: `tickets.${name}`, updated_at: current?.updated_at, value: JSON.stringify(value) } })
}

/** Tickets installed, its requesters and support staff, as the support settings name them. */
async function ticketsWorld(admin: TestClient, people: CreateUserFn) {
  expect(await discoverPackages([TICKETS])).toEqual([])
  await admin.post('/api/install_app', { name: 'tickets' })
  const person = (name: string, staff = false) =>
    people({ email: `${name}@tickets.example.test`, fullName: name[0]!.toUpperCase() + name.slice(1), roles: staff ? ['Tickets Support'] : [] })
  const w = {
    anjali: await person('anjali'), colleague: await person('colleague'),
    support: await person('triager', true), verifier: await person('verifier', true), bala: await person('bala', true),
  }
  await setting(admin, 'support_users', [w.support.user, w.verifier.user, w.bala.user])
  await setting(admin, 'verification_admins', [w.verifier.user])
  await setting(admin, 'approval_routes', { Kerala: [w.bala.user] })
  return w
}
type World = Awaited<ReturnType<typeof ticketsWorld>>

const create = async (client: TestClient, kind: string, details: object, original: string) =>
  (await act(client, 'create', { title: original, original, kind, details })).ticket as Ticket

/** A Data Quality Issue type routed to a source system's primary owner, with the approved transitions. */
async function dataQualityType(admin: TestClient, w: World, readers = 'All') {
  await makeTable(admin, { name: 'Source System', title_column: 'source_system', columns: ['source_system'] })
  await makeTable(admin, { name: 'System Owner', columns: [
    { column_name: 'source_system', column_type: 'Reference', reference_table: 'Source System' }, 'person', 'is_primary:Check'] })
  await grantRole(admin, { role: readers, table: ['Source System', 'System Owner'], can_read: true })
  const systems: Record<string, string> = {}
  for (const name of ['SAP', 'StyleHR']) systems[name] = String((await save(admin, 'Source System', { source_system: name })).row_id)
  await save(admin, 'System Owner', { source_system: systems.SAP, person: w.bala.user, is_primary: true })
  await setting(admin, 'linked_tables', ['Source System', 'System Owner'])
  const transitions = [
    { state: 'Raised', action: 'Confirm', next_state: 'Fix planned', allowed: 'assignee', fields: ['fix_what', 'fix_where', 'target_date'] },
    { state: 'Fix planned', action: 'Mark fixed', next_state: 'Fixed: to verify', allowed: 'assignee', fields: ['what_changed'] },
    { state: 'Fixed: to verify', action: 'Verify', next_state: 'Closed', allowed: 'requester' },
    { state: 'Fixed: to verify', action: 'Verify', next_state: 'Closed', allowed: 'Data Quality Verifier' },
    { state: 'Fixed: to verify', action: 'Not fixed', next_state: 'Fix planned', allowed: 'requester', fields: ['still_wrong'] },
  ]
  const type = await save(admin, 'tickets.ticket_type', { type_key: 'data_quality_issue', label: 'Data Quality Issue', enabled: true,
    states: ['Raised', 'Fix planned', 'Fixed: to verify', 'Closed'].join('\n'), done_states: 'Closed',
    routing: JSON.stringify({ field: 'source_system', table: 'System Owner', match: 'source_system', person: 'person', primary: 'is_primary' }),
    transitions: JSON.stringify(transitions) })
  let order = 0
  for (const [field_name, label, field_type, extra] of [
    ['source_system', 'Source system', 'link', { link_table: 'Source System', link_label: 'source_system' }],
    ['urgency', 'Urgency', 'choice', { choices: 'Now\nLater' }],
    ['fix_what', 'What will be fixed', 'long text', {}], ['fix_where', 'Where it will be fixed', 'text', {}],
    ['target_date', 'Target date', 'date', {}], ['what_changed', 'What was changed', 'long text', {}],
    ['still_wrong', 'What is still wrong', 'long text', {}],
  ] as const)
    await save(admin, 'tickets.type_field', { ticket_type: type.row_id, field_order: ++order, field_name, label, field_type, ...extra })
  return systems
}

/** Tasker installed from `directory`, the scenario's System Manager admitted. */
async function installTasker(admin: TestClient, directory = TASKER) {
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'tasker' })
  await admitTasker(admin)
}
const page = (client: TestClient, path: string) => client.fetch(path, { headers: { accept: 'text/html' } })

// #1178 (D8): what the deploy pipeline sends, every file of a built app folder.
async function filesOf(folder: string, under = ''): Promise<{ path: string; data: string }[]> {
  const out: { path: string; data: string }[] = []
  for (const entry of await readdir(join(folder, under), { withFileTypes: true })) {
    const path = under ? `${under}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...await filesOf(folder, path))
    else out.push({ path, data: (await readFile(join(folder, path))).toString('base64') })
  }
  return out
}
const DELIVERY_KEY = 'a-long-random-deploy-key-for-tests-only-0123456789'
const deliver = async (folder: string, key = DELIVERY_KEY) => server.request('/deliver/app', {
  method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({ files: await filesOf(folder) }) })

describe('trusted-runtime-packages', () => {
  // ---- An app's code fix can be delivered to a running instance ----

  async function runningVersionOne(admin: TestClient) {
    const installed = await mkdtemp(resolve('test/.delivery-installed-'))
    const storage = await mkdtemp(resolve('test/.delivery-storage-'))
    await cp(OTHER, installed, { recursive: true })
    vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([installed]))
    vi.stubEnv('FILE_STORAGE_DIR', storage)
    vi.stubEnv('APP_DELIVERY_TOKEN', DELIVERY_KEY)
    expect(await discoverPackages([installed])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    const fixed = await mkdtemp(resolve('test/.delivery-fixed-'))
    await cp(installed, fixed, { recursive: true })
    const html = await readFile(join(fixed, 'client/index.html'), 'utf8')
    await writeFile(join(fixed, 'client/index.html'), html.replace('<h1>Other tasks</h1>', '<h1>Other tasks, fixed</h1>'))
    const pageText = async () => (await page(admin, '/other/')).text()
    const cleanup = async () => {
      vi.unstubAllEnvs()
      for (const folder of [installed, storage, fixed]) await rm(folder, { recursive: true, force: true })
      await discoverPackages([])
      await loadInstalledApps()
    }
    return { fixed, storage, pageText, cleanup }
  }

  scenario('A delivered fix is live at once', async ({ admin }, step) => {
    let run: Awaited<ReturnType<typeof runningVersionOne>> | undefined
    try {
      await step('version 1 of an app is installed and running', async () => {
        run = await runningVersionOne(admin)
        expect(await run.pageText()).toContain('<h1>Other tasks</h1>')
      })
      await step('the deploy pipeline delivers version 1 with its page changed', async () => {
        const res = await deliver(run!.fixed)
        await expectStatus(res, 200)
        expect(await res.json()).toMatchObject({ name: 'other', version: '0.0.1', outcome: 'repinned' })
      })
      await step("the app's page shows the change at once, still as version 1", async () => {
        expect(await run!.pageText()).toContain('<h1>Other tasks, fixed</h1>')
        expect(await sql`select package_version from installed_app where name = 'other'`).toEqual([{ package_version: '0.0.1' }])
      })
    } finally { await run?.cleanup() }
  })

  // #1178 (D8): a restart serves the delivered copy; an image that brings
  // other files for the same version wins over it.
  test('a delivered copy survives a restart, and a deploy with other files replaces it', async ({ admin }) => {
    const run = await runningVersionOne(admin)
    try {
      await expectStatus(await deliver(run.fixed), 200)
      await discoverPackages(await appLibraryPaths(appPathsFromEnvironment()))
      await loadInstalledApps()
      expect(await run.pageText()).toContain('<h1>Other tasks, fixed</h1>')
      // A development server lists the app's source folder after the delivered copies; order doesn't matter.
      await discoverPackages([...appPathsFromEnvironment()].reverse())
      await loadInstalledApps()
      expect(await run.pageText()).toContain('<h1>Other tasks, fixed</h1>')
      const installed = (JSON.parse(process.env.FEATHERBASE_APP_PATHS!) as string[])[0]
      const html = await readFile(join(installed, 'client/index.html'), 'utf8')
      await writeFile(join(installed, 'client/index.html'), html.replace('<h1>Other tasks</h1>', '<h1>Other tasks, next deploy</h1>'))
      expect(await shippedDigest([installed], 'other', '0.0.1')).toBe(await artifactDigest(installed))
      // The deploy re-pins to the image's files, then the new server boots with the delivered copy still on the volume.
      await discoverPackages([installed])
      expect(await repinToFolder('other', true)).toBe('repinned')
      await discoverPackages(await appLibraryPaths(appPathsFromEnvironment()))
      await loadInstalledApps()
      expect(await run.pageText()).toContain('<h1>Other tasks, next deploy</h1>')
    } finally { await run.cleanup() }
  })

  scenario('A delivery without the deploy key is refused', async ({ admin }, step) => {
    let run: Awaited<ReturnType<typeof runningVersionOne>> | undefined
    try {
      await step('version 1 of an app is installed and running', async () => { run = await runningVersionOne(admin) })
      await step('someone delivers version 1 with its page changed but without the deploy key', async () => {
        await expectStatus(await deliver(run!.fixed, 'a-wrong-key-of-the-same-sort-0123456789abcdefghij'), 404)
      })
      await step("the delivery is refused and the app's page is unchanged", async () => {
        expect(await run!.pageText()).toContain('<h1>Other tasks</h1>')
      })
    } finally { await run?.cleanup() }
  })

  scenario('A delivery that changes what the app declares is refused', async ({ admin }, step) => {
    let run: Awaited<ReturnType<typeof runningVersionOne>> | undefined
    let res: Response | undefined
    try {
      await step('version 1 of an app is installed and running', async () => { run = await runningVersionOne(admin) })
      await step('the deploy pipeline delivers version 1 with a changed declaration', async () => {
        const manifest = JSON.parse(await readFile(join(run!.fixed, 'featherbase.json'), 'utf8'))
        await writeFile(join(run!.fixed, 'featherbase.json'), JSON.stringify({ ...manifest, title: 'Renamed tasks' }))
        res = await deliver(run!.fixed)
      })
      await step("the delivery is refused, asks for an ordinary deploy, and the app's page is unchanged", async () => {
        await expectStatus(res!, 409)
        expect(JSON.stringify(await res!.json())).toContain('ordinary deploy')
        expect(await run!.pageText()).toContain('<h1>Other tasks</h1>')
        // Refused before anything of it was kept or loaded.
        expect(await readdir(join(run!.storage, 'delivered-apps'))).toEqual([])
      })
    } finally { await run?.cleanup() }
  })

  // ---- An upgrade needs only the new version ----

  scenario('An app upgrades once its old files are gone', async ({ admin }, step) => {
    const first = await mkdtemp(resolve('test/.upgrade-first-'))
    const second = await mkdtemp(resolve('test/.upgrade-second-'))
    try {
      await step('the user installed version 1 of an app and added a row to it', async () => {
        await cp(OTHER, first, { recursive: true })
        expect(await discoverPackages([first])).toEqual([])
        await admin.post('/api/install_app', { name: 'other' })
        await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'kept', quantity: 7 } })
      })
      await step('the server now holds only version 2 of that app', async () => {
        // Version 2 adds a Notes column, with the step that moves version 1 to it.
        await cp(OTHER, second, { recursive: true })
        const manifest = JSON.parse(await readFile(join(second, 'featherbase.json'), 'utf8'))
        const pkg = JSON.parse(await readFile(join(second, 'package.json'), 'utf8'))
        const column = { column_name: 'notes', label: 'Notes', column_type: 'Text' }
        manifest.tables[0].columns.push(column)
        manifest.migrations = [{ id: 'add_notes', fromVersion: pkg.version, toVersion: '2.0.0',
          operations: [{ kind: 'addColumn', table: 'other.task', column }] }]
        await writeFile(join(second, 'package.json'), JSON.stringify({ ...pkg, version: '2.0.0' }))
        await writeFile(join(second, 'featherbase.json'), JSON.stringify(manifest))
        await rm(first, { recursive: true, force: true })
        expect(await discoverPackages([second])).toEqual([])
      })
      await step('the user previews and applies the upgrade to version 2', async () => {
        const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
        await admin.post('/api/upgrade_app', { name: 'other', version: '2.0.0', planId: plan.planId })
        await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })
      })
      await step('the app is on version 2 and the row is still there', async () => {
        expect(await sql`select package_version from installed_app where name = 'other'`).toEqual([{ package_version: '2.0.0' }])
        expect(await sql`select quantity, notes from other.task where row_id = 'kept'`).toEqual([{ quantity: 7, notes: null }])
      })
    } finally {
      await rm(first, { recursive: true, force: true })
      await rm(second, { recursive: true, force: true })
      await discoverPackages([])
      await loadInstalledApps()
    }
  })

  // ---- An app owns its screen under the shared top bar ----

  scenario('A missing piece stays missing', async ({ admin }, step) => {
    let missing!: Response
    await step('the user is using Tasker', async () => {
      await installTasker(admin)
      const home = await page(admin, '/tasker/')
      await expectStatus(home, 200)
      expect(await home.text()).toContain('<featherbase-bar data-app="tasker"')
    })
    await step("a piece of Tasker's content cannot load", async () => { missing = await admin.fetch('/tasker/missing-navigation-proof.js') })
    await step('that piece is shown as missing', () => expectStatus(missing, 404))
    await step("neither Tasker's home nor Featherbase replaces it", async () => {
      expect(missing.headers.get('content-type') ?? '').not.toContain('text/html')
      const body = await missing.text()
      expect(body).not.toContain('<featherbase-bar')
      expect(body).not.toContain('<div id="root">')
    })
  })

  scenario('An app can be delivered without rebuilding core', async ({ admin }, step) => {
    let delivered = ''
    try {
      await step("Featherbase has been built without Tasker's client files", async () => {
        // The platform's own pages name no app: none of its routes is Tasker's.
        const routes = await readFile(join(REPO, 'apps/web/src/router.tsx'), 'utf8')
        expect(routes.toLowerCase()).not.toContain('tasker')
      })
      await step('built Tasker is installed', async () => {
        // Its built package, delivered on its own beside the platform.
        delivered = await mkdtemp(resolve('test/.delivered-tasker-'))
        for (const file of ['featherbase.json', 'package.json', 'dist']) await cp(join(TASKER, file), join(delivered, file), { recursive: true })
        await installTasker(admin, delivered)
      })
      await step('Tasker opens with the shared navigation without rebuilding Featherbase or adding an app-specific platform route', async () => {
        const home = await page(admin, '/tasker/')
        await expectStatus(home, 200)
        const html = await home.text()
        expect(html).toContain('<featherbase-bar data-app="tasker" data-title="Tasker"')
        expect(html).toContain('<script type="module" src="/featherbase/bar.js"></script>')
        const script = /src="(\/tasker\/[^"]+\.js)"/.exec(html)?.[1]
        expect(script, "the page loads Tasker's own built script").toBeDefined()
        const served = await admin.fetch(script!)
        await expectStatus(served, 200)
        expect(served.headers.get('content-type')).toContain('javascript')
      })
    } finally {
      if (delivered) await rm(delivered, { recursive: true, force: true })
      await discoverPackages([])
      await loadInstalledApps()
    }
  })

  // ---- An app knows the roles of the person it acts for ----

  scenario('Tickets offers a step to the holder of a role', async ({ tickets, people }, step) => {
    let w!: World
    let ticket!: Ticket
    let holder!: TestClient
    await step('a Data Quality Issue that Bala has marked fixed', async () => {
      w = await ticketsWorld(tickets, people)
      const systems = await dataQualityType(tickets, w)
      ticket = await create(w.anjali, 'data_quality_issue', { source_system: systems.SAP, urgency: 'Now' }, 'Two plants carry both door numbers')
      expect(ticket.assigned_to).toBe(w.bala.user)
      ticket = (await act(w.bala, 'transition', { ...revision(ticket), action: 'Confirm',
        values: { fix_what: 'Door number', fix_where: 'SAP plant master', target_date: '2026-11-10' } })).ticket
      ticket = (await act(w.bala, 'transition', { ...revision(ticket), action: 'Mark fixed',
        values: { what_changed: 'Corrected the door number for plant 1100' } })).ticket
      expect(ticket.ticket_state).toBe('Fixed: to verify')
    })
    await step('a person who holds the "Data Quality Verifier" role and is not involved in the ticket', async () => {
      await grantRole(tickets, { role: 'Data Quality Verifier', table: 'tickets.ticket', can_read: true })
      holder = await people({ email: 'dq-verifier@tickets.example.test', fullName: 'DQ Verifier', roles: ['Data Quality Verifier'] })
      expect([ticket.owner, ticket.assigned_to]).not.toContain(holder.user)
    })
    let offered: string[] = []
    await step('that person opens the ticket in Tickets', async () => {
      offered = ((await detail(holder, ticket)).actions ?? []).map((a: { action: string }) => a.action)
    })
    await step('Tickets offers that person the verification', () => expect(offered).toContain('Verify'))
  })

  // ---- An app can choose its accent colour ----

  scenario('An accent Featherbase does not provide is refused', async ({ admin }, step) => {
    let answer!: { status: number; body: any }
    try {
      await step('an app names an accent that Featherbase does not provide', async () => {
        const manifest = JSON.parse(await readFile(join(PLUM, 'featherbase.json'), 'utf8')) as { accent: string }
        expect(APP_ACCENTS as readonly string[]).not.toContain(manifest.accent)
        await discoverPackages([TICKETS, PLUM])
      })
      await step('a System Manager installs that app', async () => {
        answer = await attempt(admin.fetch('/api/install_app', { method: 'POST', body: JSON.stringify({ name: 'plumproof' }) }))
      })
      await step('the installation is refused and names the accents Featherbase provides', async () => {
        expect(answer.status).toBeGreaterThanOrEqual(400)
        for (const accent of APP_ACCENTS) expect(JSON.stringify(answer.body)).toContain(accent)
        const { installed } = await admin.get<{ installed: { name: string }[] }>('/api/apps')
        expect(installed.map((app) => app.name)).not.toContain('plumproof')
      })
    } finally {
      await discoverPackages([])
      await loadInstalledApps()
    }
  })

  // ---- Packages can protect stable identities and retained records ----

  scenario('Shared ticket visibility cannot rename a stable reference', async ({ tickets, people }, step) => {
    let w!: World
    let ticket!: Ticket
    const original = 'Please give me MotherDuck access'
    let answer!: { status: number; body: unknown }
    await step('Anjali has an access ticket visible in the shared queue', async () => {
      w = await ticketsWorld(tickets, people)
      ticket = await create(w.anjali, 'access', { email: 'anjali@example.com', scope: 'Gold sales, read only' }, original)
    })
    await step('the user is another requester without support permissions', async () => {
      const roles = await sql`select role from has_role where parent = ${w.colleague.user!}`
      expect(roles.map((r) => r.role)).not.toContain('Tickets Support')
    })
    await step("the user attempts to rename Anjali's ticket", async () => {
      answer = await attempt(w.colleague.fetch(`/api/table/tickets.ticket/${ticket.row_id}:rename`,
        { method: 'POST', body: JSON.stringify({ new_name: 'changed-by-another-requester' }) }))
    })
    await step("the rename is refused and the original reference still opens its private request for Anjali", async () => {
      refused(answer.status)
      const saved = await detail(w.anjali, ticket)
      expect(saved.ticket.row_id).toBe(ticket.row_id)
      expect(saved.details.original).toBe(original)
    })
  })

  scenario('Administrator cannot erase protected evidence', async ({ tickets, people }, step) => {
    let w!: World
    let ticket!: Ticket
    let before!: Record<string, unknown>
    let answer!: { status: number; body: unknown }
    await step("Anjali's missing-invoice ticket has a recorded mismatch", async () => {
      w = await ticketsWorld(tickets, people)
      const complaint = 'Invoices cleared two days ago are missing from the report'
      ticket = await create(w.anjali, 'freshness', { complaint }, complaint)
      ticket = (await act(w.support, 'evidence', { ...revision(ticket), expected: '2 invoices from source-check-1', observed: '0 from report-check-1',
        reference: 'source-check-1; report-check-1', observed_at: '2026-11-03T09:00:00Z', finding: 'confirmed_mismatch' })).ticket
    })
    await step('Administrator attempts to delete its evidence using the current revision', async () => {
      const event = (await detail(w.support, ticket)).privateEvents.find((e: { operation: string }) => e.operation === 'evidence')
      before = await tickets.get(`/api/table/tickets.event/${event.row_id}`)
      answer = await attempt(tickets.fetch(`/api/table/tickets.event/${event.row_id}?updated_at=${encodeURIComponent(String(before.updated_at))}`, { method: 'DELETE' }))
    })
    await step('deletion is refused and the evidence remains attributed in support history', async () => {
      refused(answer.status)
      expect(await tickets.get(`/api/table/tickets.event/${before.row_id}`)).toEqual(before)
      const text = JSON.stringify(await detail(w.support, ticket))
      for (const value of ['source-check-1', 'report-check-1', w.support.user!]) expect(text).toContain(value)
    })
  })

  // ---- An app's actions and reads know their caller's own name ----

  scenario('Tickets records the name of the person acting', async ({ tickets, people }, step) => {
    let w!: World
    let ticket!: Ticket
    await step('the user is signed in as Anjali', async () => { w = await ticketsWorld(tickets, people) })
    await step('the user submits "Please check the Palakkad totals" as a free-text request', async () => {
      ticket = await create(w.anjali, 'generic', {}, 'Please check the Palakkad totals')
    })
    await step("support sees the requester by the name Anjali's own session shows, not by her person id", async () => {
      const own = (await read(w.anjali, 'session')).user.full_name
      expect(own).toBeTruthy()
      expect(own).not.toBe(w.anjali.user)
      expect((await detail(w.support, ticket)).names[ticket.owner]).toBe(own)
    })
  })

  // ---- An install or enable takes effect without a restart ----

  scenario('Tickets turned on by another process works at once', async ({ tickets, people }, step) => {
    let w!: World
    let answer!: Response
    await step('Tickets was turned off and then turned on again by another process while the server ran', async () => {
      w = await ticketsWorld(tickets, people)
      await setAppEnabled('tickets', false)
      // Another process turns it back on: the database changes, this server is not told.
      await sql`update installed_app set enabled = true where name = 'tickets'`
    })
    await step('Anjali opens Tickets', async () => {
      answer = await w.anjali.fetch('/api/app_reads/tickets/session', { method: 'POST', body: JSON.stringify({ payload: {} }) })
    })
    await step('Tickets answers without a restart', () => expectStatus(answer, 200))
  })

  scenario('A changed app under the same version says why', async ({ tickets, people }, step) => {
    let w!: World
    let answer!: Response
    await step('the installed Tickets 0.1.0 records a different build than the one this server holds', async () => {
      w = await ticketsWorld(tickets, people)
      await setAppEnabled('tickets', false)
      await sql`update installed_app set enabled = true, artifact_digest = 'an-earlier-build' where name = 'tickets'`
    })
    await step('Anjali opens Tickets', async () => {
      answer = await w.anjali.fetch('/api/app_reads/tickets/session', { method: 'POST', body: JSON.stringify({ payload: {} }) })
    })
    await step('the refusal says its files changed under the same version and how to fix it', async () => {
      const refusal = await expectRefused(answer, 403)
      expect(refusal.message).toMatch(/files changed on this server under the same version.*install-app tickets/)
    })
  })

  // ---- An administrator may let an app read named instance Tables ----

  scenario('Tickets reads a linked instance Table as the requester', async ({ tickets, people }, step) => {
    let w!: World
    let pat!: TestClient
    const forms: Record<string, any> = {}
    await step("an administrator lists a Source System Table that only Pat may read in Tickets' linked_tables setting", async () => {
      w = await ticketsWorld(tickets, people)
      await grantRole(tickets, { role: 'Tickets Person Reader', table: 'Person', can_read: true })
      pat = await people({ email: 'pat@tickets.example.test', fullName: 'Pat', roles: ['All', 'Tickets Person Reader'] })
      await dataQualityType(tickets, w, 'Tickets Person Reader')
    })
    await step('Pat and Anjali open the Data Quality Issue form', async () => {
      for (const [name, client] of [['Pat', pat], ['Anjali', w.anjali]] as const)
        forms[name] = (await read(client, 'form')).types.find((type: { key: string }) => type.key === 'data_quality_issue')
    })
    await step("Pat's Source system field offers its rows and Anjali's offers none", () => {
      const options = (form: any) => form.fields.find((f: { name: string }) => f.name === 'source_system').options.map((o: { label: string }) => o.label).sort()
      expect(options(forms.Pat)).toEqual(['SAP', 'StyleHR'])
      expect(options(forms.Anjali)).toEqual([])
    })
  })
})
