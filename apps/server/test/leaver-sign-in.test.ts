// #1271: Leavers Who Can Still Sign In, rebuilt by the server from the leaver job's own plan and
// the people app. It changes nobody. Fixtures: the leaver check's stub warehouse, and a copy of
// test-apps/fixtures/bar-proof that describes people (as person-standing.test.ts).
import { afterEach, expect } from 'vitest'
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
import { leaverSignInRows, refreshLeaverSignIn } from '../src/leaver-sign-in'

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

test("the leaver job's own plan lists its leavers, with the date they left and how they still sign in", async ({ admin }) => {
  await applySeedPack('jeyarama')
  await configureGoogle({ enabled: true, client_id: 'made-up' })
  const gone = await makePerson({ full_name: 'Gone By Plan' })
  await linkStyleHrRecord(gone, '701')
  await password(gone)
  await googleLink(gone, 'gone.plan@gmail.com')
  warehouse([rec('701', 'C-701', { exit_date: '2026-10-03', movement_active: false })])
  void admin
  expect(await leaverSignInRows()).toEqual([
    { person: gone, why: 'Left on 03-Oct-2026', ways_in: 'Password, Google', left_on: '2026-10-03', source: 'leaver job' },
  ])
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
  const rows = await leaverSignInRows()
  expect(rows).toContainEqual({ person: googleLeaver, why: 'Left on 30-Sep-2026', ways_in: 'Google', left_on: '2026-09-30', source: 'people app' })
  expect(rows).toContainEqual({ person: outsider, why: 'Not an employee, holds a StyleHR link', ways_in: 'StyleHR', left_on: null, source: 'not an employee' })
  expect(rows.map((r) => r.person)).not.toContain(noWayIn)
  expect(rows.map((r) => r.person)).not.toContain(disabled)
})

test('a refresh replaces the rows, changes nobody, and the routes are for System Managers only', async ({ admin, createUser }) => {
  await installDescriber(admin)
  await configureGoogle({ enabled: true, client_id: 'made-up' })
  const leaver = await makePerson({ full_name: 'Listed Leaver' })
  await googleLink(leaver, 'listed@gmail.com')
  await sql`insert into leaver_sign_in (row_id, person, why, ways_in, source) values ('old-row-1271', 'Administrator', 'stale', 'Password', 'leaver job')`
  globalThis.__standing1271 = { [leaver]: { person: leaver, status: 'left' } }
  expect(await refreshLeaverSignIn()).toBe(1)
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
