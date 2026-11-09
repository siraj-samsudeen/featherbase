// #1046: an app may add its own check to who opens it (`access.gate`, one of
// its reads, failing closed) and name its own roles as approvers, who are
// mailed about people waiting and may list them. Fixture: a copy of
// test-apps/fixtures/bar-proof with an `access` block and a few more reads.
import { afterEach, describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { appCatalog, discoverPackages } from '../src/runtime-packages'
import { _setAlertSender } from '../src/waiting-for-access'
import { sql } from '../src/db'
import { expectStatus } from './fixtures'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')

const directories: string[] = []
afterEach(async () => {
  _setAlertSender(null)
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const tableRead = { policy: { kind: 'table' }, authorization: { kind: 'generic' } }

/** bar-proof, given `access` and the reads `yes`, `no_note`, `approver` and `waiting_list`. */
async function gated(access: Record<string, unknown>, roles: string[] | null = ['Bar Reader']) {
  const directory = await mkdtemp(resolve('test/.b5-1046-gate-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  if (roles) manifest.roles = roles
  else delete manifest.roles
  manifest.reads.operations = { ...manifest.reads.operations, yes: tableRead, no_note: tableRead, waiting_list: tableRead, approver: tableRead,
    roles_of: tableRead, role_names: tableRead, own_notes: tableRead }
  manifest.baseTables = { read: { 'barproof.note': ['body'] } }
  manifest.access = access
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `
reads.yes = () => true
reads.no_note = async ({ documents }) => (await documents.list('barproof.note', { fields: ['body'] })).length === 0
reads.waiting_list = ({ people }) => people.waitingForAccess()
reads.approver = ({ roles }) => roles.includes('Bar Approver')
reads.roles_of = ({ people, payload }) => people.rolesOf(payload.person)
reads.role_names = ({ people }) => people.roleNames()
reads.own_notes = ({ baseTables }) => baseTables.list('barproof.note', { fields: ['body'] })
`)
  return directory
}

/** A read as the app's own page sends it, naming the installed version. */
async function appRead(client: TestClient, read: string, payload: Record<string, unknown> = {}): Promise<{ result: unknown }> {
  const response = await client.fetch(`/api/app_reads/barproof/${read}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Featherbase-App-Version': 'barproof@1.0.0' }, body: JSON.stringify({ payload }),
  })
  await expectStatus(response, 200)
  return response.json() as Promise<{ result: unknown }>
}
const waitingList = (client: TestClient) => appRead(client, 'waiting_list') as Promise<{ result: unknown[] }>

const opens = async (user: string) => (await appCatalog(user)).some((entry) => entry.name === 'barproof')

describe('an app gate: discovery', () => {
  test('a gate that is not one of the app\'s reads is refused', async () => {
    expect(await discoverPackages([await gated({ gate: 'nothing' })])).toEqual([
      expect.objectContaining({ error: "The app's gate is its read nothing, which is not one of the app's reads" }),
    ])
  })

  test('an approver that is not one of the app\'s roles is refused', async () => {
    expect(await discoverPackages([await gated({ approvers: ['System Manager'] })])).toEqual([
      expect.objectContaining({ error: "The app's access approvers must be its own roles: System Manager" }),
    ])
  })

  test('an app with no roles of its own has no approvers to name', async () => {
    expect(await discoverPackages([await gated({ approvers: ['Bar Approver'] }, null)])).toEqual([
      expect.objectContaining({ error: "The app's access approvers must be its own roles: Bar Approver" }),
    ])
  })

  test.for(['view=access', '?View=x', '?a b'])('an access page %j is refused', async (page) => {
    expect(await discoverPackages([await gated({ page })])).toEqual([expect.objectContaining({ error: expect.any(String) })])
  })
})

describe('an app gate: who opens the app', () => {
  async function install(admin: TestClient, createUser: CreateUserFn, access: Record<string, unknown>, roles?: string[]) {
    expect(await discoverPackages([await gated(access, roles)])).toEqual([])
    await admin.post('/api/install_app', { name: 'barproof' })
    return createUser({ email: 'gate-reader@example.test', roles: ['Bar Reader'] })
  }

  test('a gate answering true opens the app for someone holding its role', async ({ admin, createUser }) => {
    const reader = await install(admin, createUser, { gate: 'yes' })
    expect(await opens(reader.user!)).toBe(true)
  })

  test.for(['malformed', 'broken'])('a gate answering anything but true, or failing (%s), keeps it closed', async (gate, { admin, createUser }) => {
    const reader = await install(admin, createUser, { gate })
    expect(await opens(reader.user!)).toBe(false)
  })

  test('the gate is read fresh: the app closes as soon as its answer changes', async ({ admin, createUser }) => {
    const reader = await install(admin, createUser, { gate: 'no_note' })
    expect(await opens(reader.user!)).toBe(true)
    await admin.post('/api/save_row', { table: 'barproof.note', row: { row_id: 'n1', body: 'closes it' } })
    expect(await opens(reader.user!)).toBe(false)
  })

  test("approvers are mailed with the app's own page, and only they and System Managers list who is waiting", async ({ admin, createUser }) => {
    expect(await discoverPackages([await gated({ gate: 'approver', approvers: ['Bar Approver'], page: '?view=access' }, ['Bar Reader', 'Bar Approver'])])).toEqual([])
    await admin.post('/api/install_app', { name: 'barproof' })
    const reader = await createUser({ email: 'gate-reader@example.test', roles: ['Bar Reader'] })
    const approver = await createUser({ email: 'gate-approver@example.test', roles: ['Bar Reader', 'Bar Approver'] })
    await sql`update person set email = 'gate-approver@example.test' where row_id = ${approver.user!}`
    const mailed: { to: string; body: string }[] = []
    _setAlertSender(async (message) => { mailed.push({ to: message.to, body: message.body }) })
    await expectStatus(await reader.fetch('/barproof/', { headers: { accept: 'text/html' } }), 403)
    expect(mailed.find((m) => m.to === 'gate-approver@example.test')?.body).toContain('/barproof/?view=access')

    const list = (client: TestClient) => waitingList(client) as Promise<{ result: { person: string }[] }>
    expect((await list(approver)).result.map((r) => r.person)).toEqual([reader.user])
    expect((await list(admin)).result.map((r) => r.person)).toEqual([reader.user])
    // A name that is still an address isn't shown.
    await sql`update person set full_name = 'gate-reader@example.test' where row_id = ${reader.user!}`
    expect((await waitingList(admin)).result).toEqual([expect.objectContaining({ person: reader.user, name: null })])
  })

  test('someone who opens the app but is not an approver lists no one', async ({ admin, createUser }) => {
    const reader = await install(admin, createUser, { gate: 'yes', approvers: ['Bar Approver'] }, ['Bar Reader', 'Bar Approver'])
    expect((await waitingList(reader)).result).toEqual([])
  })

  test("an app says why someone has a role: the roles a current person holds, none for anyone else", async ({ admin, createUser }) => {
    const reader = await install(admin, createUser, { gate: 'yes' })
    expect((await appRead(admin, 'roles_of', { person: reader.user })).result).toEqual(expect.arrayContaining(['Bar Reader']))
    expect((await appRead(admin, 'roles_of', { person: reader.user })).result).not.toContain('All')
    expect((await appRead(admin, 'roles_of', { person: 'nobody@example.test' })).result).toEqual([])
    expect((await appRead(admin, 'roles_of', { person: 42 })).result).toEqual([])
    await sql`update person set enabled = false where row_id = ${reader.user!}`
    expect((await appRead(admin, 'roles_of', { person: reader.user })).result).toEqual([])
  })

  test('an app lists the roles it may give, without the platform\'s own', async ({ admin, createUser }) => {
    await install(admin, createUser, { gate: 'yes' })
    const names = (await appRead(admin, 'role_names')).result as string[]
    expect(names).toContain('Bar Reader')
    expect(names).not.toContain('System Manager')
    expect(names).toEqual([...names].sort())
  })

  test("an app reads its own Tables without the instance listing them", async ({ admin, createUser }) => {
    await install(admin, createUser, { gate: 'yes' })
    await admin.post('/api/save_row', { table: 'barproof.note', row: { row_id: 'n1', body: 'kept' } })
    expect((await appRead(admin, 'own_notes')).result).toEqual([expect.objectContaining({ body: 'kept' })])
  })
})
