// #1267 step 3: who a person is to the organisation, as the app that knows the
// people says it (`people.describe`). Fixture: a copy of test-apps/fixtures/bar-proof
// declaring a describe read whose answers the tests set. Dash's own answer is
// tested beside its code (client-apps/jeyarama/dash/src/people-describe.test.ts).
import { afterEach, describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { grantRole } from './fixtures'
import { configureDelegated, configureGoogle } from './identity-fixtures'
import { getSignInMethod, methodOfKind } from '../src/identities'
import { assertEligible, linkVerifiedToSelf } from '../src/sign-in'
import { describeActor } from '../src/person-standing'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const tableRead = { policy: { kind: 'table' }, authorization: { kind: 'generic' } }

declare global {
  // eslint-disable-next-line no-var
  var __standing: Record<string, unknown> | undefined
  // eslint-disable-next-line no-var
  var __describe: 'fail' | 'slow' | 'junk' | undefined
  // eslint-disable-next-line no-var
  var __describedAs: string | undefined
}

const directories: string[] = []
afterEach(async () => {
  globalThis.__standing = undefined
  globalThis.__describe = undefined
  globalThis.__describedAs = undefined
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** bar-proof that describes people: each person's answer is `__standing[person]`, else 'none'. */
async function describing(people: Record<string, unknown> = { describe: 'describe' }) {
  const directory = await mkdtemp(resolve('test/.b5-1267-standing-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.reads.operations = { ...manifest.reads.operations, describe: tableRead }
  manifest.people = people
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `
reads.describe = ({ payload, user }) => {
  globalThis.__describedAs = user
  if (globalThis.__describe === 'fail') throw new Error('down')
  if (globalThis.__describe === 'slow') return new Promise((r) => setTimeout(() => r([]), 4000))
  if (globalThis.__describe === 'junk') return { not: 'a list' }
  return payload.persons.map((person) => globalThis.__standing?.[person] ?? { person, status: 'none' })
}
`)
  return directory
}

async function installDescriber(admin: TestClient) {
  expect(await discoverPackages([await describing()])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
}

describe('what an app declares', () => {
  test("a describe read that is not one of the app's reads is refused", async () => {
    expect(await discoverPackages([await describing({ describe: 'nobody' })])).toEqual([
      expect.objectContaining({ error: "The app's people are described by its read nobody, which is not one of the app's reads" }),
    ])
  })
})

test('with no app describing people, everyone reads as External', async ({ admin, createUser }) => {
  const asha = await createUser({ email: 'asha.1267@example.test' })
  expect(await admin.get(`/api/people/${asha.user}/standing`)).toEqual({ status: 'none', code: null, jobs: [], external_label: null })
})

test("a person's standing is the app's answer, asked as the app's own actor, not the viewer", async ({ admin, createUser }) => {
  await installDescriber(admin)
  const ravi = await createUser({ email: 'ravi.1267@example.test' })
  const note = await admin.post<{ row_id: string }>('/api/save_row', { table: 'barproof.note', row: { row_id: 'N-1267-1', body: 'Lakeside' } })
  globalThis.__standing = { [ravi.user!]: { person: ravi.user, status: 'current', code: '2001', jobs: [{ job: 'Team Leader', site: { table: 'barproof.note', id: note.row_id, name: 'Lakeside' } }] } }
  expect(await admin.get(`/api/people/${ravi.user}/standing`)).toEqual({
    status: 'current', code: '2001', external_label: null,
    jobs: [{ job: 'Team Leader', site: { table: 'barproof.note', id: note.row_id, name: 'Lakeside' } }],
  })
  expect(globalThis.__describedAs).toBe(describeActor('barproof'))
})

test('a store the viewer may not open is left out; the job stays', async ({ admin, createUser }) => {
  await installDescriber(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Person Reader' } })
  await grantRole(admin, { table: 'Person', role: 'Person Reader', can_read: true })
  const reader = await createUser({ email: 'reader.1267@example.test', roles: ['Person Reader'] })
  const ravi = await createUser({ email: 'ravi2.1267@example.test' })
  const note = await admin.post<{ row_id: string }>('/api/save_row', { table: 'barproof.note', row: { row_id: 'N-1267-2', body: 'Lakeside' } })
  globalThis.__standing = { [ravi.user!]: { person: ravi.user, status: 'current', code: '2002', jobs: [{ job: 'Team Leader', site: { table: 'barproof.note', id: note.row_id, name: 'Lakeside' } }] } }
  expect((await reader.get<{ jobs: unknown[] }>(`/api/people/${ravi.user}/standing`)).jobs).toEqual([{ job: 'Team Leader' }])
})

test('a viewer who may not read the Person is refused', async ({ admin, createUser }) => {
  await installDescriber(admin)
  const outsider = await createUser({ email: 'outsider.1267@example.test' })
  const ravi = await createUser({ email: 'ravi3.1267@example.test' })
  const answer = await outsider.fetch(`/api/people/${ravi.user}/standing`)
  expect([403, 404]).toContain(answer.status)
  expect(globalThis.__describedAs).toBeUndefined()
})

test.for(['fail', 'slow', 'junk'] as const)('a describer that answers %s reads as unknown, never as External', async (mode, { admin, createUser }) => {
  await installDescriber(admin)
  const mia = await createUser({ email: `mia-${mode}.1267@example.test` })
  await sql`update person set external_label = 'Vendor' where row_id = ${mia.user!}`
  globalThis.__describe = mode
  expect(await admin.get(`/api/people/${mia.user}/standing`)).toEqual({ status: 'unknown', code: null, jobs: [], external_label: null })
})

test('the External label shows only while the person is External', async ({ admin, createUser }) => {
  await installDescriber(admin)
  const ext = await createUser({ email: 'ext.1267@example.test' })
  const emp = await createUser({ email: 'emp.1267@example.test' })
  await sql`update person set external_label = 'Vendor' where row_id in (${ext.user!}, ${emp.user!})`
  globalThis.__standing = { [emp.user!]: { person: emp.user, status: 'current', code: null, jobs: [] } }
  expect((await admin.get<{ external_label: string | null }>(`/api/people/${ext.user}/standing`)).external_label).toBe('Vendor')
  expect((await admin.get<{ external_label: string | null }>(`/api/people/${emp.user}/standing`)).external_label).toBeNull()
})

test('the label takes Consultant or Vendor, nothing else', async ({ createUser }) => {
  const p = await createUser({ email: 'label.1267@example.test' })
  await expect(sql`update person set external_label = 'Partner' where row_id = ${p.user!}`).rejects.toThrow(/person_external_label_known/)
})

describe('an employees-only sign-in method', () => {
  const link = (admin: { fetch: (path: string, init?: RequestInit) => Promise<Response> }, person: string, subject: string) =>
    admin.fetch(`/api/people/${encodeURIComponent(person)}/identities`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'stylehr', subject }),
    })

  test('is refused for a former employee or someone external, by name of the reason', async ({ admin, createUser }) => {
    await installDescriber(admin)
    await configureDelegated()
    await sql`update sign_in_method set employees_only = true where row_id = 'stylehr'`
    const left = await createUser({ email: 'left.1267@example.test' })
    const ext = await createUser({ email: 'ext2.1267@example.test' })
    globalThis.__standing = { [left.user!]: { person: left.user, status: 'left', code: '9', jobs: [] } }
    const refusedLeft = await link(admin, left.user!, 'RR-1')
    expect(refusedLeft.status).toBe(417)
    expect(await refusedLeft.text()).toContain('StyleHR sign-in is only for current employees, and this person is a former employee')
    const refusedExt = await link(admin, ext.user!, 'RR-2')
    expect(await refusedExt.text()).toContain('this person is not an employee')
    expect(await sql`select 1 from sign_in_identity where person_id in (${left.user!}, ${ext.user!})`).toHaveLength(0)
  })

  test('links a current employee, and anyone while the describer cannot answer', async ({ admin, createUser }) => {
    await installDescriber(admin)
    await configureDelegated()
    await sql`update sign_in_method set employees_only = true where row_id = 'stylehr'`
    const emp = await createUser({ email: 'emp2.1267@example.test' })
    const someone = await createUser({ email: 'someone.1267@example.test' })
    globalThis.__standing = { [emp.user!]: { person: emp.user, status: 'current', code: '1', jobs: [] } }
    expect((await link(admin, emp.user!, 'RR-3')).status).toBe(201)
    globalThis.__describe = 'fail'
    expect((await link(admin, someone.user!, 'RR-4')).status).toBe(201)
  })

  test('is not moved to someone external', async ({ admin, createUser }) => {
    await installDescriber(admin)
    await configureDelegated()
    await sql`update sign_in_method set employees_only = true where row_id = 'stylehr'`
    const emp = await createUser({ email: 'emp3.1267@example.test' })
    const ext = await createUser({ email: 'ext3.1267@example.test' })
    globalThis.__standing = { [emp.user!]: { person: emp.user, status: 'current', code: '1', jobs: [] } }
    const { id } = await admin.post<{ id: string }>(`/api/people/${encodeURIComponent(emp.user!)}/identities`, { method: 'stylehr', subject: 'RR-5' })
    const moved = await admin.fetch(`/api/identities/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person_id: ext.user }),
    })
    expect(moved.status).toBe(417)
    expect(await moved.text()).toContain('not an employee')
  })

  test('a method without the mark links anyone', async ({ admin, createUser }) => {
    await installDescriber(admin)
    await configureDelegated()
    const ext = await createUser({ email: 'ext4.1267@example.test' })
    expect((await link(admin, ext.user!, 'RR-6')).status).toBe(201)
  })
})

// Codex round 1: an installed describer that cannot answer reads as unknown; every way a
// link or a sign-in is made asks the employees-only question.
describe('an installed people app that cannot answer', () => {
  test('makes everyone unknown, never External, and refuses no link', async ({ admin, createUser }) => {
    await installDescriber(admin)
    await configureDelegated()
    await sql`update sign_in_method set employees_only = true where row_id = 'stylehr'`
    await sql`update installed_app set enabled = false where name = 'barproof'`
    const someone = await createUser({ email: 'off.1267@example.test' })
    expect((await admin.get<{ status: string }>(`/api/people/${someone.user}/standing`)).status).toBe('unknown')
    const linked = await admin.fetch(`/api/people/${encodeURIComponent(someone.user!)}/identities`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'stylehr', subject: 'RR-OFF' }),
    })
    expect(linked.status).toBe(201)
  })
})

describe('every way in asks the employees-only question', () => {
  test('a Google invite for someone external is refused when Google is employees only', async ({ admin, createUser }) => {
    await installDescriber(admin)
    await configureGoogle({ enabled: true, client_id: 'made-up-client' })
    await sql`update sign_in_method set employees_only = true where row_id = 'google'`
    const ext = await createUser({ email: 'invite-ext.1267@example.test' })
    const invited = await admin.fetch(`/api/people/${encodeURIComponent(ext.user!)}/identities`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'google', email: 'invite-ext.1267@gmail.com', send_invitation_email: false }),
    })
    expect(invited.status).toBe(417)
    expect(await invited.text()).toContain('Google sign-in is only for current employees')
  })

  test("a person linking their own Google account is refused when they are external", async ({ admin, createUser }) => {
    await installDescriber(admin)
    await configureGoogle({ enabled: true, client_id: 'made-up-client', self_link: true })
    await sql`update sign_in_method set employees_only = true where row_id = 'google'`
    const ext = await createUser({ email: 'self-ext.1267@example.test' })
    const google = (await methodOfKind('google'))!
    await expect(linkVerifiedToSelf(google, ext.user!, { status: 'verified', subject: 'g-self-1267', email: 'self-ext.1267@gmail.com', email_verified: true }))
      .rejects.toThrow('Google sign-in is only for current employees')
  })

  test('a former employee already linked cannot sign in with an employees-only method; an employee can', async ({ admin, createUser }) => {
    await installDescriber(admin)
    await configureDelegated()
    const left = await createUser({ email: 'signin-left.1267@example.test' })
    const emp = await createUser({ email: 'signin-emp.1267@example.test' })
    await sql`update sign_in_method set employees_only = true where row_id = 'stylehr'`
    globalThis.__standing = {
      [left.user!]: { person: left.user, status: 'left', code: '7', jobs: [] },
      [emp.user!]: { person: emp.user, status: 'current', code: '8', jobs: [] },
    }
    const stylehr = (await getSignInMethod('stylehr'))!
    await expect(assertEligible(stylehr, left.user!)).rejects.toThrow()
    await expect(assertEligible(stylehr, emp.user!)).resolves.toBeUndefined()
  })
})
