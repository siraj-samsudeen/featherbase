// #1222: View as, on the platform. An app names a role that may view as someone (`viewAs.role`)
// and a read that finds people (`viewAs.people`); the platform swaps who a read runs as, and any
// change runs as the tester themself. Fixture: a copy of test-apps/fixtures/bar-proof with `viewAs` declared.
// Dash's own platform test (client-apps/jeyarama/dash/platform-test/view-as.test.ts) shows it with
// real reach.
import { afterEach, describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sandboxRequest } from './pg-test-shared'
import { discoverPackages } from '../src/runtime-packages'
import { issueAccessToken } from '../src/auth'
import { logAccess, logActivity } from '../src/audit'
import { runViewingAs } from '../src/view-as-context'
import { viewAsRoute } from '../src/view-as'
import { rowCapabilities } from '../src/document'
import { sql } from '../src/db'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const TESTER = 'Bar Tester'
const tableRead = { policy: { kind: 'table' }, authorization: { kind: 'generic' } }

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** bar-proof with View as: `Bar Tester` may view as someone, and `people` finds them. */
async function viewable(viewAs: Record<string, unknown> = { role: TESTER, people: 'people' }, roles = ['Bar Reader', TESTER]) {
  const directory = await mkdtemp(resolve('test/.b5-1222-view-as-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.roles = roles
  manifest.permissions = [...manifest.permissions, { table: 'barproof.note', role: TESTER, can_read: true }]
  manifest.reads.operations = { ...manifest.reads.operations, people: tableRead }
  manifest.viewAs = viewAs
  await writeFile(file, JSON.stringify(manifest))
  // People are made up from the payload. Each answer carries an email the picker must never show.
  await appendFile(resolve(directory, 'server.mjs'), `
reads.people = ({ payload, roles, reject }) => {
  if (!roles.includes('${TESTER}')) reject('Only a Bar Tester')
  const ids = payload.persons ?? (payload.q ? globalThis.__viewAsPeople ?? [] : [])
  return ids.map(person => ({ person, name: 'Made-up ' + person.slice(-4), code: 'C-' + person.slice(-4), jobs: ['Team Leader · Lakeside'], email: 'secret@example.test' }))
}
`)
  return directory
}

const json = { 'content-type': 'application/json' }
const start = (client: TestClient, person: unknown) => client.fetch('/api/view_as/start', { method: 'POST', headers: json, body: JSON.stringify({ person }) })
const status = async (sent: Promise<Response>) => { const r = await sent; return [r.status, await r.text()] as const }

async function install(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([await viewable()])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  const tester = await createUser({ email: 'tester@example.test', roles: [TESTER] })
  const person = await createUser({ email: 'person@example.test', roles: ['Bar Reader'] })
  const manager = await createUser({ email: 'manager@example.test', roles: ['System Manager'] })
  return { tester, person, manager }
}

describe('View as: what an app declares', () => {
  test("a View as role that is not one of the app's roles is refused", async () => {
    expect(await discoverPackages([await viewable({ role: 'System Manager', people: 'people' })])).toEqual([
      expect.objectContaining({ error: "The app's View as role must be one of its own roles: System Manager" }),
    ])
  })

  test("a people read that is not one of the app's reads is refused", async () => {
    expect(await discoverPackages([await viewable({ role: TESTER, people: 'nobody' })])).toEqual([
      expect.objectContaining({ error: "The app's View as people are found by its read nobody, which is not one of the app's reads" }),
    ])
  })
})

describe('View as: which requests run as the person viewed', () => {
  test.for([['GET', '/api/table/ToDo', 'read'], ['POST', '/api/app_reads/dash/reports', 'read'], ['POST', '/api/dashboard/count', 'read'], ['POST', '/api/row_titles', 'read'], ['POST', '/api/access_log', 'read'], ['POST', '/api/sales_target/embed_session', 'read'],
    ['POST', '/api/save_row', 'tester'], ['POST', '/api/app_actions/dash/give_report', 'tester'], ['DELETE', '/api/table/ToDo/x', 'tester'], ['POST', '/api/view_as/exit', 'tester'], ['GET', '/api/view_as', 'tester'], ['POST', '/api/events', 'drop']] as const)(
    '%s %s is handled as %s', ([method, path, route]) => {
      expect(viewAsRoute(method, path)).toBe(route)
    })
})

describe('View as on the platform', () => {
  test('reads run as the person; a change runs as the tester, never as the person', async ({ admin, createUser }) => {
    const { person } = await install(admin, createUser)
    // This tester can also save rows themself, so a change that went through as the person would show.
    const tester = await createUser({ email: 'tester-manager@example.test', roles: [TESTER, 'System Manager'] })
    expect((await tester.get<{ row_id: string }>('/api/whoami')).row_id).toBe(tester.user)
    expect((await status(start(tester, person.user)))[0]).toBe(200)
    expect((await tester.get<{ row_id: string }>('/api/whoami')).row_id).toBe(person.user)
    const saved = await tester.fetch('/api/save_row', { method: 'POST', headers: json, body: JSON.stringify({ table: 'ToDo', row: { description: 'made while viewing', allocated_to: tester.user } }) })
    expect([saved.status, saved.status === 201 ? '' : await saved.text()]).toEqual([201, ''])
    expect(await sql`select created_by from todo where description = 'made while viewing'`).toEqual([{ created_by: tester.user }])
    // The browser's recent-pages trail is accepted and not recorded.
    const events = await sql`select count(*)::int as n from user_event`
    expect((await tester.fetch('/api/events', { method: 'POST', headers: json, body: JSON.stringify({ events: [{ kind: 'page', key: 'x' }] }) })).status).toBe(204)
    expect(await sql`select count(*)::int as n from user_event`).toEqual(events)
  })

  test('the picker shows what the app says about each person, never an email, and never yourself or a System Manager', async ({ admin, createUser }) => {
    const { tester, person, manager } = await install(admin, createUser)
    ;(globalThis as { __viewAsPeople?: string[] }).__viewAsPeople = [person.user!, tester.user!, manager.user!]
    try {
      const found = await tester.get<Record<string, unknown>[]>('/api/view_as/people?q=made')
      expect(found).toEqual([{ person: person.user, name: `Made-up ${person.user!.slice(-4)}`, code: `C-${person.user!.slice(-4)}`, jobs: ['Team Leader · Lakeside'] }])
    } finally { delete (globalThis as { __viewAsPeople?: string[] }).__viewAsPeople }
  })

  test('someone the app does not list is still found by name, as the app describes them', async ({ admin, createUser }) => {
    const { tester, person } = await install(admin, createUser)
    const found = await tester.get<{ person: string }[]>('/api/view_as/people?q=person')
    expect(found.map((p) => p.person)).toEqual([person.user])
    // A typed % or _ is a character, not a wildcard.
    expect(await tester.get('/api/view_as/people?q=%25%25')).toEqual([])
  })

  test('an access token never views as anyone', async ({ admin, createUser }) => {
    const { tester, person } = await install(admin, createUser)
    const { token } = await issueAccessToken(tester.user!, 'view as 1222', null)
    const agent = makeClient({ request: sandboxRequest }, token, tester.user)
    expect(await status(start(agent, person.user))).toEqual([403, expect.stringContaining('Only a View As Tester')])
  })

  test('while viewing, a row offers no change of any kind', async ({ admin, createUser }) => {
    const { tester } = await install(admin, createUser)
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: 'ToDo', row: { description: 'a row', allocated_to: 'Administrator' } })
    const own = await rowCapabilities('ToDo', row.row_id, 'Administrator')
    expect(own.write && own.delete && own.tag).toBe(true)
    const viewed = await runViewingAs({ tester: tester.user!, person: 'Administrator', name: 'Made-up' }, () => rowCapabilities('ToDo', row.row_id, 'Administrator'))
    expect(Object.values(viewed).every((allowed) => allowed === false)).toBe(true)
  })

  test('what is read while viewing is logged under the tester, marked with whom', async ({ admin, createUser }) => {
    const { tester, person } = await install(admin, createUser)
    await runViewingAs({ tester: tester.user!, person: person.user!, name: 'Made-up' }, () => logAccess(person.user!, 'view_report', { table: 'barproof.x', scope: 'store=9901' }))
    expect(await sql`select "user", scope from access_log where operation = 'view_report'`).toEqual([{ user: tester.user, scope: `viewing as ${person.user}; store=9901` }])
    await runViewingAs({ tester: tester.user!, person: person.user!, name: 'Made-up' }, () => logActivity(person.user!, 'identifier_search staff'))
    expect(await sql`select "user", created_by, operation from activity_log where operation like 'identifier_search%'`)
      .toEqual([{ user: tester.user, created_by: tester.user, operation: `identifier_search staff (viewing as ${person.user})` }])
  })
})
