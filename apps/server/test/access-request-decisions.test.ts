// #1173: a System Manager acts on a waiting request from the Waiting for
// access page: approve with roles (and app grants, tested with Dash in its
// platform tests), decline with a reason, or dismiss a false alarm. Every
// decision is one activity row; nothing is mailed. Made-up people only.
import { afterEach, describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { expectStatus } from './fixtures'
import { saveDoc } from '../src/document'
import { _setAlertSender, DECLINED_LINE, noAccessYetPage, requestAccess } from '../src/waiting-for-access'
import { resolve } from 'node:path'
import { discoverPackages, runGrant } from '../src/runtime-packages'

afterEach(() => _setAlertSender(null))

const mailed: string[] = []
const quiet = () => { mailed.length = 0; _setAlertSender(async (m) => { mailed.push(m.subject) }) }

async function role(name: string) {
  const [have] = await sql`select 1 from role where row_id = ${name}`
  if (!have) await saveDoc('Role', { row_id: name }, 'Administrator')
}

async function waiting(person: string, app = 'featherbase'): Promise<string> {
  await requestAccess(person, app)
  const [row] = await sql`select row_id from access_request where person = ${person} and app_name = ${app}`
  return String(row.row_id)
}

const details = (client: TestClient, id: string) => client.fetch(`/api/access_request/${id}`)
const decide = (client: TestClient, id: string, what: 'approve' | 'decline' | 'dismiss', body: Record<string, unknown> = {}) =>
  client.fetch(`/api/access_request/${id}/${what}`, { method: 'POST', body: JSON.stringify(body) })
const rolesOf = async (person: string) =>
  (await sql`select role from has_role where parent = ${person} and parenttype = 'Person' order by role`).map((r) => String(r.role))
const activity = (person: string) =>
  sql`select "user", operation from activity_log where operation like ${`access\\_% ${person} %`} order by created_at`
const count = async (client: TestClient) => ((await (await client.fetch('/api/people/waiting_for_access/count')).json()) as { count: number }).count

describe('what the drawer shows', () => {
  test('who they are, how they sign in, what they asked for, the roles they hold and the roles that can be given', async ({ admin, createUser }) => {
    quiet()
    await role('Master Data Editor')
    await role('Tasker Member')
    const asha = await createUser({ email: 'asha.made-up@example.com', roles: ['Tasker Member'] })
    await sql`update person set full_name = 'Asha Made-up' where row_id = ${asha.user!}`
    await sql`insert into sign_in_method (row_id, kind, label, enabled) values ('stylehr-made-up', 'delegated', 'StyleHR', true)`
    await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by) values ('sid-asha', ${asha.user!}, 'stylehr-made-up', 'sub-asha', 'EMP0412', 'Administrator')`
    await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by, ended_at, ended_reason) values ('sid-asha-old', ${asha.user!}, 'stylehr-made-up', 'sub-old', 'EMP0001', 'Administrator', now(), 'moved')`
    const id = await waiting(asha.user!)
    const res = await details(admin, id)
    await expectStatus(res, 200)
    const body = await res.json()
    expect(body).toMatchObject({
      id, app: 'Featherbase', app_name: 'featherbase', declined: null,
      person: { id: asha.user, full_name: 'Asha Made-up', email: 'asha.made-up@example.com' },
      roles_held: ['Tasker Member'],
    })
    expect(body.sign_ins).toEqual(expect.arrayContaining([{ method: 'StyleHR', sign_in_name: 'EMP0412' }]))
    expect(body.sign_ins).not.toEqual(expect.arrayContaining([expect.objectContaining({ sign_in_name: 'EMP0001' })]))
    expect(typeof body.asked_at).toBe('string')
    expect(body.role_choices).toEqual(expect.arrayContaining(['Master Data Editor', 'System Manager', 'Tasker Member']))
    for (const automatic of ['Administrator', 'All', 'Guest']) expect(body.role_choices).not.toContain(automatic)
    expect(body.apps).toEqual([])
  })

  test('a role System Settings gives everyone shows as held by everyone, and cannot be given again', async ({ admin, createUser }) => {
    quiet()
    await role('Dash Reader')
    await admin.post('/api/save_row', { table: 'System Settings', row: { everyone_roles: 'Dash Reader' } })
    const nila = await createUser({ email: 'nila.made-up@example.com', roles: [] })
    const id = await waiting(nila.user!)
    const body = await (await details(admin, id)).json()
    expect(body).toMatchObject({ roles_held: [], roles_for_everyone: ['Dash Reader'] })
    expect((await decide(admin, id, 'approve', { roles: ['Dash Reader'] })).status).toBe(417)
  })

  test('only a System Manager may see it', async ({ createUser }) => {
    quiet()
    const asha = await createUser({ email: 'asha.two@example.com', roles: [] })
    const clerk = await createUser({ email: 'clerk.made-up@example.com', roles: ['Data Quality Manager'] })
    const id = await waiting(asha.user!)
    expect((await details(clerk, id)).status).toBe(403)
  })

  test('an unknown request is not found', async ({ admin }) => {
    expect((await details(admin, 'nope')).status).toBe(404)
  })
})

describe('approve', () => {
  test('gives the ticked roles, keeps the ones they had, records one activity row, sends no mail and closes the request', async ({ admin, createUser }) => {
    quiet()
    await role('Master Data Editor')
    await role('Tasker Member')
    const asha = await createUser({ email: 'asha.three@example.com', roles: ['Tasker Member'] })
    // A role with no grant does not open Featherbase, so the request stays
    // until it opens (item 9).
    const id = await waiting(asha.user!)
    const sent = mailed.length
    const res = await decide(admin, id, 'approve', { roles: ['Master Data Editor'] })
    await expectStatus(res, 200)
    expect(await rolesOf(asha.user!)).toEqual(['Master Data Editor', 'Tasker Member'])
    const rows = await activity(asha.user!)
    expect(rows.filter((r) => String(r.operation).startsWith('access_granted'))).toHaveLength(1)
    expect(rows.at(-1)).toMatchObject({ user: admin.user ?? 'Administrator' })
    expect(String(rows.at(-1)!.operation)).toContain('roles Master Data Editor')
    expect(mailed.length).toBe(sent)
    // Master Data Editor does not open Featherbase: given, and the request stays.
    expect(await res.json()).toMatchObject({ given: ['Master Data Editor'], open: false })
    expect(await count(admin)).toBe(1)
  })

  test('a role that opens the app closes the request', async ({ admin, createUser }) => {
    quiet()
    const asha = await createUser({ email: 'asha.four@example.com', roles: [] })
    const id = await waiting(asha.user!)
    const res = await decide(admin, id, 'approve', { roles: ['System Manager'], confirm_full_admin: true })
    await expectStatus(res, 200)
    expect(await res.json()).toMatchObject({ open: true })
    expect(await count(admin)).toBe(0)
  })

  test('System Manager needs the full-admin confirmation', async ({ admin, createUser }) => {
    quiet()
    const asha = await createUser({ email: 'asha.five@example.com', roles: [] })
    const id = await waiting(asha.user!)
    expect((await decide(admin, id, 'approve', { roles: ['System Manager'] })).status).toBe(417)
    expect(await rolesOf(asha.user!)).toEqual([])
  })

  test('nothing new picked, an unknown role or an automatic role is refused', async ({ admin, createUser }) => {
    quiet()
    await role('Tasker Member')
    const asha = await createUser({ email: 'asha.six@example.com', roles: ['Tasker Member'] })
    const id = await waiting(asha.user!)
    for (const body of [{}, { roles: [] }, { roles: ['Tasker Member'] }, { roles: ['No Such Role'] }, { roles: ['Administrator'] }, { roles: ['All'] }, { roles: 'x' },
      { grants: [{ app: 'featherbase', choice: 'anything' }] }, { grants: [{ app: 'no_such_app', choice: 'x' }] }])
      expect((await decide(admin, id, 'approve', body)).status).toBe(417)
    expect(await rolesOf(asha.user!)).toEqual(['Tasker Member'])
  })

  test('only a System Manager may approve', async ({ createUser }) => {
    quiet()
    await role('Master Data Editor')
    const asha = await createUser({ email: 'asha.seven@example.com', roles: [] })
    const clerk = await createUser({ email: 'clerk.two.made-up@example.com', roles: ['Data Quality Manager'] })
    const id = await waiting(asha.user!)
    expect((await decide(clerk, id, 'approve', { roles: ['Master Data Editor'] })).status).toBe(403)
    expect(await rolesOf(asha.user!)).toEqual([])
  })
})

describe('decline', () => {
  test('needs a reason, keeps the request as declined, off the waiting count, and the person is told without the reason', async ({ admin, createUser }) => {
    quiet()
    const asha = await createUser({ email: 'asha.eight@example.com', roles: [] })
    const id = await waiting(asha.user!)
    expect((await decide(admin, id, 'decline', {})).status).toBe(417)
    expect((await decide(admin, id, 'decline', { reason: '   ' })).status).toBe(417)
    expect((await decide(admin, id, 'decline', { reason: 'x'.repeat(501) })).status).toBe(417)
    await expectStatus(await decide(admin, id, 'decline', { reason: 'Not in head office' }), 200)
    const [row] = await sql`select declined_at, declined_by, declined_reason from access_request where row_id = ${id}`
    expect(row).toMatchObject({ declined_by: admin.user ?? 'Administrator', declined_reason: 'Not in head office' })
    expect(row.declined_at).toBeTruthy()
    expect(await count(admin)).toBe(0)
    expect(String((await activity(asha.user!)).at(-1)!.operation)).toBe(`access_declined for ${asha.user} in featherbase: Not in head office`)
    // Opening it again: told it was declined, no new alert, no reason shown.
    const sent = mailed.length
    const again = await asha.fetch('/api/access_request', { method: 'POST', body: JSON.stringify({ app: 'featherbase' }) })
    expect(await again.json()).toEqual({ state: 'declined', title: 'Featherbase' })
    expect(mailed.length).toBe(sent)
    // The drawer shows the decline.
    expect((await (await details(admin, id)).json()).declined).toMatchObject({ reason: 'Not in head office', by: admin.user ?? 'Administrator' })
  })

  test('a declined request goes once they get access by any route', async ({ admin, createUser }) => {
    quiet()
    const asha = await createUser({ email: 'asha.nine@example.com', roles: [] })
    const id = await waiting(asha.user!)
    await decide(admin, id, 'decline', { reason: 'Ask HR' })
    const [p] = await sql`select updated_at from person where row_id = ${asha.user!}`
    await saveDoc('Person', { row_id: asha.user!, updated_at: p.updated_at, roles: [{ role: 'System Manager' }] }, 'Administrator')
    await count(admin)
    expect(await sql`select 1 from access_request where row_id = ${id}`).toHaveLength(0)
  })

  test('only a System Manager may decline', async ({ createUser }) => {
    quiet()
    const asha = await createUser({ email: 'asha.ten@example.com', roles: [] })
    const clerk = await createUser({ email: 'clerk.three@example.com', roles: ['Data Quality Manager'] })
    const id = await waiting(asha.user!)
    expect((await decide(clerk, id, 'decline', { reason: 'x' })).status).toBe(403)
  })
})

describe('dismiss', () => {
  test('deletes the request and records it; opening the app again is a fresh request', async ({ admin, createUser }) => {
    quiet()
    const asha = await createUser({ email: 'asha.eleven@example.com', roles: [] })
    const id = await waiting(asha.user!)
    await expectStatus(await decide(admin, id, 'dismiss'), 200)
    expect(await sql`select 1 from access_request where row_id = ${id}`).toHaveLength(0)
    expect(String((await activity(asha.user!)).at(-1)!.operation)).toBe(`access_dismissed for ${asha.user} in featherbase`)
    const again = await asha.fetch('/api/access_request', { method: 'POST', body: JSON.stringify({ app: 'featherbase' }) })
    expect(await again.json()).toEqual({ state: 'waiting', title: 'Featherbase' })
    expect(await count(admin)).toBe(1)
  })

  test('only a System Manager may dismiss', async ({ createUser }) => {
    quiet()
    const asha = await createUser({ email: 'asha.twelve@example.com', roles: [] })
    const clerk = await createUser({ email: 'clerk.four@example.com', roles: ['Data Quality Manager'] })
    const id = await waiting(asha.user!)
    expect((await decide(clerk, id, 'dismiss')).status).toBe(403)
    expect(await sql`select 1 from access_request where row_id = ${id}`).toHaveLength(1)
  })
})

// Main's CI after the 16-Nov train: the drawer with an app that gives its own access, on the platform
// alone (test-apps/grant-proof), not only through Dash's platform tests.
describe("an app's own access in the drawer (#1173)", () => {
  const PIN = { 'X-Featherbase-App-Version': 'grantproof@1.0.0' }
  async function setup(admin: TestClient, createUser: (o: { email: string; roles?: string[] }) => Promise<TestClient>) {
    quiet()
    expect(await discoverPackages([resolve('../..', 'test-apps/grant-proof')])).toEqual([])
    await admin.post('/api/install_app', { name: 'grantproof' })
    const asha = await createUser({ email: 'grant-asha@example.test', roles: [] })
    const seed = (gift: string, person = asha.user) => admin.fetch('/api/save_row', { method: 'POST', headers: PIN, body: JSON.stringify({ table: 'grantproof.gift', row: { person, gift } }) })
    return { asha, seed, id: await waiting(asha.user!, 'grantproof') }
  }
  const refused = async (response: Promise<Response>, text: string) => {
    const answer = await response
    expect([answer.status, await answer.text()]).toEqual([417, expect.stringContaining(text)])
  }
  type Details = { role_hints: Record<string, number>; apps: { app: string; title: string; about: unknown[]; choices: { id: string; given: boolean }[]; problem?: string }[] }

  test("shows the app's section: what it says about them and each choice, marking what they have, and hints from their peers' roles", async ({ admin, createUser }) => {
    const { seed, id } = await setup(admin, createUser)
    await seed('a')
    await role('Gift Reader')
    const peer = await createUser({ email: 'grant-peer@example.test', roles: ['Gift Reader'] })
    await seed('peer', peer.user)
    const shown = await (await details(admin, id)).json() as Details
    expect(shown.apps).toEqual([{ app: 'grantproof', title: 'Gifts', about: [{ label: 'Job', value: 'Tester' }],
      choices: [expect.objectContaining({ id: 'gift:a', given: true }), expect.objectContaining({ id: 'gift:b', given: false }), expect.objectContaining({ id: 'gift:fail', given: false })] }])
    expect(shown.role_hints).toMatchObject({ 'Gift Reader': 1 })
  })

  test("says plainly when the app's options fail, or come back in a shape it can't use", async ({ admin, createUser }) => {
    const { seed, id } = await setup(admin, createUser)
    await seed('boom')
    expect(((await (await details(admin, id)).json()) as Details).apps).toEqual([expect.objectContaining({ choices: [], problem: "Couldn't load what Gifts can give" })])
    const other = await createUser({ email: 'grant-odd@example.test', roles: [] })
    await seed('odd', other.user)
    const oddId = await waiting(other.user!, 'grantproof')
    expect(((await (await details(admin, oddId)).json()) as Details).apps).toEqual([expect.objectContaining({ choices: [], problem: "Couldn't load what Gifts can give" })])
  })

  test('gives each picked choice through the app once, reports a refused one, and records what was given', async ({ admin, createUser }) => {
    const { asha, id } = await setup(admin, createUser)
    const response = await decide(admin, id, 'approve', { grants: [{ app: 'grantproof', choice: 'gift:b' }, { app: 'grantproof', choice: 'gift:b' }, { app: 'grantproof', choice: 'gift:fail' }] })
    expect(await response.json()).toEqual({ given: ['Gifts: Gift Books'], failed: [{ label: 'Gifts: Gift Refused one', problem: 'Not this one' }], open: false })
    expect((await activity(asha.user!)).map((r) => String(r.operation)).filter(o => o.startsWith('access_granted'))).toEqual([`access_granted for ${asha.user} in grantproof: Gifts: Gift Books`])
  })

  test('refuses a choice the app does not offer, an app that gives nothing from here, and only what they already have', async ({ admin, createUser }) => {
    const { seed, id } = await setup(admin, createUser)
    await seed('a')
    await refused(decide(admin, id, 'approve', { grants: [{ app: 'grantproof', choice: 'gift:zzz' }] }), 'Gifts offers no such choice')
    await refused(decide(admin, id, 'approve', { grants: [{ app: 'nothing-here', choice: 'x' }] }), 'nothing-here gives no access from here')
    await refused(decide(admin, id, 'approve', { grants: [{ app: 'grantproof', choice: 'gift:a' }] }), 'Pick a role or something else')
  })

  test('a decision sent with a body that is not JSON is read as an empty one', async ({ admin, createUser }) => {
    const { id } = await setup(admin, createUser)
    const response = await admin.fetch(`/api/access_request/${id}/dismiss`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' })
    expect(await response.json()).toEqual({ dismissed: id })
  })

  test("an app's grant read or action is refused when the app isn't loaded here", async () => {
    await expect(runGrant('no-such-app', 'read', 'anything', {}, 'Administrator')).rejects.toMatchObject({ type: 'NotFoundError', message: 'App is unavailable' })
  })

  test('an unknown decision is not found', async ({ admin, createUser }) => {
    const { id } = await setup(admin, createUser)
    expect((await decide(admin, id, 'bogus' as 'approve')).status).toBe(404)
  })
})

describe('the page a declined person sees (#1173)', () => {
  test('says it was declined, never why, with the app name escaped', () => {
    const page = noAccessYetPage('R&D <Reports>', true)
    expect(page).toContain(DECLINED_LINE)
    expect(page).toContain('R&amp;D &lt;Reports&gt;')
    expect(page).toContain('data-testid="access-declined"')
  })
})
