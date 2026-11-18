// #1271: Leavers Who Can Still Sign In, rebuilt by the server from the leaver job's own plan and
// the people app. It changes nobody. Fixtures: the leaver check's stub warehouse, and a copy of
// test-apps/fixtures/bar-proof that describes people (as person-standing.test.ts).
import { afterEach, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { applySeedPack } from '../src/seed-packs'
import { newIdentifierId } from '../src/person-identifiers'
import { discoverPackages } from '../src/runtime-packages'
import { configureDelegated, configureGoogle } from './identity-fixtures'
import { _setWarehouseReader, type EmployeeRecord } from '../src/leaver-check'
import { leaverSignInRows, rebuildSummary, refreshLeaverSignIn } from '../src/leaver-sign-in'

/** Today in India, as the leaver check reckons it. */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const directories: string[] = []
declare global {
  // eslint-disable-next-line no-var
  var __standing1271: Record<string, unknown> | undefined
}
afterEach(async () => {
  _setWarehouseReader(null)
  globalThis.__standing1271 = undefined
  vi.unstubAllEnvs()
  for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true })
})

async function installDescriber(admin: TestClient) {
  const directory = await mkdtemp(resolve('test/.b5-1271-leavers-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.reads.operations = { ...manifest.reads.operations, describe: { policy: { kind: 'table' }, authorization: { kind: 'generic' } } }
  manifest.people = { describe: 'describe' }
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `
reads.describe = ({ payload }) => payload.persons.map((person) => globalThis.__standing1271?.[person] ?? { person, status: 'current' })
`)
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
}

const rec = (key: string, code: string, over: Partial<EmployeeRecord> = {}): EmployeeRecord => ({
  employee_key: key, employee_code: code, payroll_active: true, movement_active: true, date_of_joining: '2024-01-01', exit_date: null, ...over,
})
function warehouse(records: EmployeeRecord[]) {
  _setWarehouseReader(async (q) => q.includes('attendance') ? [[istToday()]]
    : records.map((r) => [r.employee_key, r.employee_code, r.payroll_active, r.movement_active, r.date_of_joining, r.exit_date]))
}
async function linkStyleHrRecord(person: string, id: string) {
  await sql`insert into person_identifier (id, person_id, system, assigner, value, valid, verified, one_holder, source, recorded_by)
    values (${newIdentifierId()}, ${person}, 'stylehr-employee-id', '', ${id}, daterange('2024-01-01'::date, null::date, '[)'), true, false, 'test', 'test')`
}
const password = (person: string) => sql`update person set password_hash = 'x' where row_id = ${person}`
const googleLink = (person: string, email: string) => sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
  values (${'uid_' + person.slice(-8)}, ${person}, 'google', ${'g-' + person}, ${email}, 'Administrator')`

test("the leaver job's own plan lists its leavers with the rule that hit them, then the System Managers it never disables", async () => {
  await applySeedPack('jeyarama')
  await configureGoogle({ enabled: true, client_id: 'made-up' })
  const gone = await makePerson({ full_name: 'Gone By Plan' })
  const inactive = await makePerson({ full_name: 'Inactive By Plan' })
  const boss = await makePerson({ full_name: 'Boss By Plan' })
  await linkStyleHrRecord(gone, '701')
  await linkStyleHrRecord(inactive, '702')
  await linkStyleHrRecord(boss, '703')
  await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values ('hr_boss_1271', ${boss}, 'Person', 'roles', 'System Manager')`
  for (const p of [gone, inactive, boss]) await password(p)
  await googleLink(gone, 'gone.plan@gmail.com')
  warehouse([
    rec('701', 'C-701', { exit_date: '2026-10-03', movement_active: false }),
    rec('702', 'C-702', { movement_active: false }),
    rec('703', 'C-703', { exit_date: '2026-09-01' }),
  ])
  const report = await leaverSignInRows()
  expect(report.notes).toEqual(['No app says who people are, so sections 3 and 4 are not checked'])
  expect(report.rows).toEqual(
    [
      { section: '1. Leaver job would disable', person: gone, why: 'Exit date 03-Oct-2026 has passed', ways_in: 'Password, Google', left_on: '2026-10-03' },
      { section: '1. Leaver job would disable', person: inactive, why: 'Marked inactive in StyleHR', ways_in: 'Password', left_on: null },
      { section: '2. System Manager: never disabled by the job', person: boss, why: 'Exit date 01-Sep-2026 has passed', ways_in: 'Password', left_on: '2026-09-01' },
    ])
})

test('someone off the payroll with no exit date is listed in section 5 for review, outside the leaver count', async () => {
  await applySeedPack('jeyarama')
  const director = await makePerson({ full_name: 'Off Payroll Director' })
  const gone = await makePerson({ full_name: 'Gone Too' })
  await linkStyleHrRecord(director, '801')
  await linkStyleHrRecord(gone, '802')
  await password(director)
  await password(gone)
  warehouse([rec('801', 'C-801', { payroll_active: false, date_of_joining: '2010-01-01' }), rec('802', 'C-802', { exit_date: '2026-10-01' })])
  const report = await leaverSignInRows()
  expect(report.rows).toEqual([
    { section: '1. Leaver job would disable', person: gone, why: 'Exit date 01-Oct-2026 has passed', ways_in: 'Password', left_on: '2026-10-01' },
    { section: '5. Not on payroll, but no exit date', person: director, why: 'Off the latest payroll, but no exit date has passed and StyleHR does not mark them inactive', ways_in: 'Password', left_on: null },
  ])
  expect(rebuildSummary(report)).toBe('1 person can still sign in. 1 person off the payroll with no exit date, for review. No app says who people are, so sections 3 and 4 are not checked')
})

// #1271 polish: the header's numbers are the list's own rows, section by section, after a real rebuild.
test("the header's counts equal the rows in each section, and the rebuild's summary says the same numbers", async ({ admin }) => {
  await applySeedPack('jeyarama')
  const people: string[] = []
  for (const full_name of ['Gone A', 'Gone B', 'Off Payroll']) people.push(await makePerson({ full_name }))
  for (const [i, p] of people.entries()) { await linkStyleHrRecord(p, `90${i}`); await password(p) }
  warehouse([rec('900', 'C-900', { exit_date: '2026-10-01' }), rec('901', 'C-901', { movement_active: false }),
    rec('902', 'C-902', { payroll_active: false, date_of_joining: '2010-01-01' })])
  await refreshLeaverSignIn()
  const bySection = await sql`select section, count(*)::int as n from leaver_sign_in group by section`
  const rows = (pick: (s: string) => boolean) => bySection.filter((r) => pick(String(r.section))).reduce((n, r) => n + Number(r.n), 0)
  const status = await admin.get<{ counts: { can_sign_in: number; review: number }; checked_result: string }>('/api/leaver_sign_in/status')
  expect(status.counts).toEqual({ can_sign_in: rows((s) => !s.startsWith('5.')), review: rows((s) => s.startsWith('5.')) })
  expect(status.counts).toEqual({ can_sign_in: 2, review: 1 })
  expect(status.checked_result).toMatch(/^2 people can still sign in\. 1 person off the payroll with no exit date, for review/)
})

test("a plan the leaver job would refuse, or cannot read, is named; a StyleHR leaver it misses is still listed from the people app", async ({ admin }) => {
  await applySeedPack('jeyarama')
  await installDescriber(admin)
  await configureDelegated()
  const linked = await makePerson({ full_name: 'Linked Leaver' })
  await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by) values ('uid_linked1271', ${linked}, 'stylehr', 'RR-72', 'lnk', 'Administrator')`
  globalThis.__standing1271 = { [linked]: { person: linked, status: 'left', left_on: '2026-08-01' } }
  _setWarehouseReader(async (q) => q.includes('attendance') ? [['2020-01-01']] : [])
  const stale = await leaverSignInRows()
  expect(stale.notes).toEqual([expect.stringMatching(/^The leaver job's next run would refuse: the warehouse's StyleHR data is stale/)])
  expect(stale.rows).toContainEqual({
    section: "3. Left, not on the leaver job's list", person: linked, ways_in: 'StyleHR', left_on: '2026-08-01',
    why: 'The people app says they have left; the leaver job did not match their StyleHR link',
  })
  _setWarehouseReader(async () => { throw new Error('warehouse down') })
  expect((await leaverSignInRows()).notes).toEqual(["The leaver job's plan could not be read: warehouse down"])
})

test('people the people app cannot describe are counted as not checked, never left out silently', async ({ admin }) => {
  await installDescriber(admin)
  const a = await makePerson({ full_name: 'Unknown One' })
  await password(a)
  globalThis.__standing1271 = { [a]: { person: a, status: 'bogus' } }
  const report = await leaverSignInRows()
  expect(report.rows.map((r) => r.person)).not.toContain(a)
  expect(report.notes).toContainEqual(expect.stringMatching(/^The people app could not say who \d+ (person is|people are), so they are not checked$/))
})

test('only ways in that can work now count: a switched-off password, an unconfigured Google; an expected first sign-in counts', async ({ admin }) => {
  await installDescriber(admin)
  const pw = await makePerson({ full_name: 'Password Only' })
  const g = await makePerson({ full_name: 'Google Unset' })
  const expected = await makePerson({ full_name: 'Google Expected' })
  await password(pw)
  await configureGoogle({ enabled: true, client_id: '' })
  await googleLink(g, 'g.unset@gmail.com')
  await sql`update person set expects_google_sign_in = true, email = 'expected.1271@gmail.com' where row_id = ${expected}`
  globalThis.__standing1271 = Object.fromEntries([pw, g, expected].map((p) => [p, { person: p, status: 'left' }]))
  await sql`update sign_in_method set enabled = false where kind = 'password'`
  // The tests run with the mock Google sign-in on, which makes any Google method usable.
  vi.stubEnv('ALLOW_MOCK_OAUTH', '0')
  let persons = (await leaverSignInRows()).rows.map((r) => r.person)
  expect(persons).not.toContain(pw)
  expect(persons).not.toContain(g)
  expect(persons).not.toContain(expected)
  await configureGoogle({ client_id: 'made-up', allowed_email_domains: '*' })
  const rows = (await leaverSignInRows()).rows
  persons = rows.map((r) => r.person)
  expect(persons).toContain(g)
  expect(rows.find((r) => r.person === expected)?.ways_in).toBe('Google (first sign-in expected)')
})

test('an expected first sign-in counts only where its claim could succeed', async ({ admin }) => {
  await installDescriber(admin)
  await configureGoogle({ enabled: true, client_id: 'made-up', allowed_email_domains: 'example.com' })
  const ok = await makePerson({ full_name: 'Claim Ok' })
  const wrongDomain = await makePerson({ full_name: 'Wrong Domain' })
  const linked = await makePerson({ full_name: 'Already Linked' })
  const set = (p: string, email: string) => sql`update person set expects_google_sign_in = true, email = ${email} where row_id = ${p}`
  await set(ok, 'ok.1271@example.com')
  await set(wrongDomain, 'wrong.1271@elsewhere.org')
  await set(linked, 'linked.1271@example.com')
  await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by) values ('uid_lnk1271', ${linked}, 'google', 'g-lnk', 'linked.1271@example.com', 'Administrator')`
  globalThis.__standing1271 = Object.fromEntries([ok, wrongDomain, linked].map((p) => [p, { person: p, status: 'left' }]))
  const ways = new Map((await leaverSignInRows()).rows.map((r) => [r.person, r.ways_in]))
  expect(ways.get(ok)).toBe('Google (first sign-in expected)')
  expect(ways.has(wrongDomain)).toBe(false)
  expect(ways.get(linked)).toBe('Google')
})

test('a live password invitation is a way in; a used, voided, unsent or expired one is not', async ({ admin }) => {
  await installDescriber(admin)
  const live = await makePerson({ full_name: 'Invited Leaver' })
  const used = await makePerson({ full_name: 'Used Invite' })
  const voided = await makePerson({ full_name: 'Voided Invite' })
  const unsent = await makePerson({ full_name: 'Unsent Invite' })
  const expired = await makePerson({ full_name: 'Expired Invite' })
  const invite = (person: string, over: string) => sql.unsafe(`insert into password_invite (id, person, token_hash, invited_by, email, expires_at, sent_at, used_at, voided_at)
    values ('pi_' || md5('${person}'), '${person}', md5('t${person}'), 'Administrator', 'x@example.test', ${over})`)
  await invite(live, `now() + interval '1 day', now(), null, null`)
  await invite(used, `now() + interval '1 day', now(), now(), null`)
  await invite(voided, `now() + interval '1 day', now(), null, now()`)
  await invite(unsent, `now() + interval '1 day', null, null, null`)
  await invite(expired, `now() - interval '1 minute', now(), null, null`)
  globalThis.__standing1271 = Object.fromEntries([live, used, voided, unsent, expired].map((p) => [p, { person: p, status: 'left' }]))
  const rows = (await leaverSignInRows()).rows
  expect(rows.filter((r) => [live, used, voided, unsent, expired].includes(r.person)).map((r) => [r.person, r.ways_in])).toEqual([[live, 'Password (invited)']])
})

test("a link sign-in would refuse is not a way in: a System Manager's StyleHR link", async ({ admin }) => {
  await installDescriber(admin)
  await configureDelegated()
  const boss = await makePerson({ full_name: 'Boss With StyleHR' })
  await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values ('hr_boss2_1271', ${boss}, 'Person', 'roles', 'System Manager')`
  await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by) values ('uid_boss1271', ${boss}, 'stylehr', 'RR-73', 'boss', 'Administrator')`
  globalThis.__standing1271 = { [boss]: { person: boss, status: 'left' } }
  expect((await leaverSignInRows()).rows.map((r) => r.person)).not.toContain(boss)
})

test('the status reads the published rebuild, and names a later one that failed', async ({ admin }) => {
  await sql`insert into leaver_sign_in_rebuild (id, started_at, summary) values (1, now() - interval '1 hour', '2 people can still sign in')`
  await sql`update scheduled_job set last_run_at = now(), last_outcome = 'error', last_result = 'warehouse down' where row_id = 'refresh_leaver_sign_in'`
  const status = await admin.get<{ checked_result: string; last_failed: { error: string } | null }>('/api/leaver_sign_in/status')
  expect(status.checked_result).toBe('2 people can still sign in')
  expect(status.last_failed?.error).toBe('warehouse down')
  await sql`update scheduled_job set last_outcome = 'success' where row_id = 'refresh_leaver_sign_in'`
  expect((await admin.get<{ last_failed: unknown }>('/api/leaver_sign_in/status')).last_failed).toBeNull()
})

test('a rebuild that started before the one on show writes nothing', async ({ admin }) => {
  await installDescriber(admin)
  await configureGoogle({ enabled: true, client_id: 'made-up' })
  const leaver = await makePerson({ full_name: 'Newer Leaver' })
  await googleLink(leaver, 'newer@gmail.com')
  globalThis.__standing1271 = { [leaver]: { person: leaver, status: 'left' } }
  await sql`insert into leaver_sign_in_rebuild (id, started_at, summary) values (1, now() + interval '1 hour', 'newer')`
  const report = await refreshLeaverSignIn()
  expect(report.published).toBe(false)
  expect(await sql`select 1 from leaver_sign_in`).toHaveLength(0)
  expect((await sql`select summary from leaver_sign_in_rebuild`)[0].summary).toBe('newer')
  await sql`update leaver_sign_in_rebuild set started_at = now() - interval '1 hour'`
  expect((await refreshLeaverSignIn()).published).toBe(true)
  expect((await sql`select summary from leaver_sign_in_rebuild`)[0].summary).toBe('1 person can still sign in')
})

test('a pending invite is a way in, but not yet a link they hold', async ({ admin }) => {
  await installDescriber(admin)
  await configureGoogle({ enabled: true, client_id: 'made-up' })
  await sql`update sign_in_method set employees_only = true where row_id = 'google'`
  const invited = await makePerson({ full_name: 'Invited To Google' })
  await sql`insert into sign_in_identity (id, person_id, method, pending_email, linked_by) values ('uid_inv1271', ${invited}, 'google', 'inv.1271@gmail.com', 'Administrator')`
  globalThis.__standing1271 = { [invited]: { person: invited, status: 'none' } }
  // Not an employee, but the invite is not yet an employees-only link they hold: not listed in section 4.
  expect((await leaverSignInRows()).rows.map((r) => r.person)).not.toContain(invited)
  globalThis.__standing1271 = { [invited]: { person: invited, status: 'left' } }
  expect((await leaverSignInRows()).rows).toContainEqual(expect.objectContaining({ person: invited, ways_in: 'Google (invited)' }))
})

test('a second rebuild replaces the first; it never adds to it', async ({ admin }) => {
  // Rebuilds take a lock first, so two at once replace in turn. The test runs in
  // one transaction, so it can show only that each rebuild replaces the rows.
  await installDescriber(admin)
  await configureGoogle({ enabled: true, client_id: 'made-up' })
  const leaver = await makePerson({ full_name: 'Twice Leaver' })
  await googleLink(leaver, 'twice@gmail.com')
  globalThis.__standing1271 = { [leaver]: { person: leaver, status: 'left' } }
  await refreshLeaverSignIn()
  await refreshLeaverSignIn()
  expect((await sql`select person from leaver_sign_in`).map((r) => r.person)).toEqual([leaver])
})

test('the people app adds leavers with no StyleHR link, and outsiders who hold one; nobody without a way in', async ({ admin }) => {
  await installDescriber(admin)
  await configureDelegated()
  await configureGoogle({ enabled: true, client_id: 'made-up' })
  await sql`update sign_in_method set employees_only = true where row_id = 'stylehr'`
  const googleLeaver = await makePerson({ full_name: 'Google Leaver' })
  const outsider = await makePerson({ full_name: 'StyleHR Outsider' })
  const noWayIn = await makePerson({ full_name: 'No Way In' })
  const disabled = await makePerson({ full_name: 'Already Off' })
  await googleLink(googleLeaver, 'g.leaver@gmail.com')
  await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by) values ('uid_outsider1271', ${outsider}, 'stylehr', 'RR-71', 'out', 'Administrator')`
  await password(disabled)
  await sql`update person set enabled = false where row_id = ${disabled}`
  globalThis.__standing1271 = {
    [googleLeaver]: { person: googleLeaver, status: 'left', left_on: '2026-09-30' },
    [outsider]: { person: outsider, status: 'none' },
    [noWayIn]: { person: noWayIn, status: 'left' },
    [disabled]: { person: disabled, status: 'left' },
  }
  const { rows } = await leaverSignInRows()
  expect(rows).toContainEqual({ section: "3. Left, not on the leaver job's list", person: googleLeaver, why: 'The people app says they have left; with no StyleHR link the leaver job never sees them', ways_in: 'Google', left_on: '2026-09-30' })
  expect(rows).toContainEqual({ section: '4. Not an employee, holds a StyleHR link', person: outsider, why: 'Not an employee, holds a StyleHR link', ways_in: 'StyleHR', left_on: null })
  expect(rows.map((r) => r.person)).not.toContain(noWayIn)
  expect(rows.map((r) => r.person)).not.toContain(disabled)
})

test('a refresh replaces the rows, changes nobody, and the routes are for System Managers only', async ({ admin, createUser }) => {
  await installDescriber(admin)
  await configureGoogle({ enabled: true, client_id: 'made-up' })
  const leaver = await makePerson({ full_name: 'Listed Leaver' })
  await googleLink(leaver, 'listed@gmail.com')
  await sql`insert into leaver_sign_in (row_id, person, why, ways_in, section) values ('old-row-1271', 'Administrator', 'stale', 'Password', '1. Leaver job would disable')`
  globalThis.__standing1271 = { [leaver]: { person: leaver, status: 'left' } }
  expect((await refreshLeaverSignIn()).rows).toHaveLength(1)
  expect((await sql`select person from leaver_sign_in`).map((r) => r.person)).toEqual([leaver])
  expect((await sql`select enabled from person where row_id = ${leaver}`)[0].enabled).toBe(true)

  const status = await admin.get<{ leaver_job: { on: boolean } | null; checked_at: unknown }>('/api/leaver_sign_in/status')
  expect(status.leaver_job?.on).toBe(false)
  const queued = await admin.fetch('/api/leaver_sign_in/refresh', { method: 'POST' })
  expect(queued.status).toBe(202)
  expect(await sql`select 1 from background_job where method = 'refresh_leaver_sign_in' and job_status = 'queued'`).not.toHaveLength(0)

  const plain = await createUser({ email: 'plain.1271@example.test' })
  expect((await plain.fetch('/api/leaver_sign_in/status')).status).toBe(403)
  expect((await plain.fetch('/api/leaver_sign_in/refresh', { method: 'POST' })).status).toBe(403)
  expect((await plain.fetch('/api/table/Leaver Sign In')).status).toBe(403)
})

test('the refresh runs as its own job, records when it checked, and follows a leaver check', async () => {
  const { enqueue, loadJobs, runOneJob } = await import('../src/jobs')
  await loadJobs()
  await sql`delete from background_job`
  const refresh = await enqueue('refresh_leaver_sign_in', {}, { maxAttempts: 1 })
  await sql`update background_job set run_at = now() where row_id = ${refresh}`
  expect(await runOneJob()).toBe(true)
  const [job] = await sql`select last_run_at, last_result from scheduled_job where row_id = 'refresh_leaver_sign_in'`
  expect(job.last_run_at).not.toBeNull()
  expect(job.last_result).toMatch(/can still sign in/)
  // The leaver job queues a rebuild after each run, whatever it decided.
  await sql`delete from background_job`
  const check = await enqueue('disable_leavers', {}, { maxAttempts: 1 })
  await sql`update background_job set run_at = now() where row_id = ${check}`
  expect(await runOneJob()).toBe(true)
  expect(await sql`select 1 from background_job where method = 'refresh_leaver_sign_in' and job_status = 'queued'`).toHaveLength(1)
})
