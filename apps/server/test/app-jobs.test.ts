// #700: a runtime app declares its own scheduled jobs. Each is registered as
// `<app>.<job>`, kept as a Scheduled Job row for as long as the app is
// installed, follows the app through disable, upgrade and removal, and runs
// as its own system actor holding only the grants it declares. The packages
// are written per test, so each case shows exactly the manifest it proves.
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { expectApiError } from './fixtures'
import { sql } from '../src/db'
import { drainJobs, registerJob } from '../src/jobs'
import { discoverPackages, packageFailures } from '../src/runtime-packages'
import { uninstallApp } from '../src/apps'
import { applyInstanceSettings } from '../src/instance-settings'
import { newIdentifierId } from '../src/person-identifiers'

const APP = 'fbjobsa'
const SWEEP = `${APP}.sweep`
const OVERREACH = `${APP}.overreach`
const SYSTEM = 'fbjobs-code'

interface Job {
  name: string
  cadence: string
  description: string
  grants?: string[]
  identifiers?: string[]
}

const sweep: Job = {
  name: 'sweep', cadence: 'daily', description: 'Disable everyone whose code says they have left.',
  grants: ['read_people', 'disable_people', 'email_system_managers'], identifiers: [SYSTEM],
}
const overreach: Job = { name: 'overreach', cadence: 'hourly', description: 'Reads people, then tries to disable one.', grants: ['read_people'] }

// The handlers a version ships: only the jobs its manifest declares, as the
// platform requires.
const HANDLERS: Record<string, string> = {
  sweep: `async sweep(ctx) {
    const people = await ctx.people.list()
    const gone = []
    for (const p of people)
      if ((p.identifiers['${SYSTEM}'] ?? []).includes('LEFT') && await ctx.people.disable(p.person, 'their code says they left')) gone.push(p.person)
    const mailed = await ctx.email.systemManagers({ subject: 'Sweep summary', body: 'Disabled ' + gone.length })
    calls.push({ job: ctx.job.name, gone })
    ctx.setResult('disabled ' + gone.length + '; mailed ' + mailed)
  }`,
  overreach: `async overreach(ctx) {
    const [someone] = (await ctx.people.list()).filter((p) => !p.privileged)
    calls.push({ job: ctx.job.name, tried: someone.person })
    await ctx.people.disable(someone.person, 'not allowed')
  }`,
  tidy: `async tidy(ctx) { ctx.setResult('tidied') }`,
  hold: `async hold(ctx) { calls.push({ job: ctx.job.name }); ctx.refuse('the feed is stale') }`,
}
const server = (jobs: Job[]) => `export const platformVersion = '2026-10'
const calls = (globalThis.__fbjobsCalls ??= [])
export const jobs = {
${jobs.flatMap((job) => HANDLERS[job.name] ? [HANDLERS[job.name]] : []).join(',\n')}
}
`

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  ;(globalThis as { __fbjobsCalls?: unknown[] }).__fbjobsCalls = []
})

async function writeApp(opts: { name?: string; version?: string; jobs: Job[]; migrations?: unknown[]; settings?: unknown[] }) {
  // Inside the server directory, where the test runner can import from.
  const dir = await mkdtemp(resolve('test/.app-jobs-'))
  dirs.push(dir)
  const name = opts.name ?? APP
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `featherbase-${name}`, version: opts.version ?? '1.0.0', type: 'module' }))
  await writeFile(join(dir, 'featherbase.json'), JSON.stringify({
    manifestVersion: 1, platformVersion: '2026-10', name, title: 'Jobs proof', entryTable: `${name}.note`, server: 'server.mjs',
    tables: [{ name: `${name}.note`, label: 'Note', id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] }],
    jobs: opts.jobs, migrations: opts.migrations ?? [], ...(opts.settings ? { settings: opts.settings } : {}),
  }))
  await writeFile(join(dir, 'server.mjs'), server(opts.jobs))
  return dir
}

// The sandbox's clock is its transaction's start, earlier than a run queued
// just now; make every queued run due, then drain the queue.
async function runDue() {
  await sql`update background_job set run_at = now() - interval '1 second' where job_status = 'queued'`
  await drainJobs()
}

const calls = () => (globalThis as { __fbjobsCalls?: unknown[] }).__fbjobsCalls ?? []
const row = async (method: string) => (await sql`select * from scheduled_job where method = ${method}`)[0]
const queued = async (method: string) => (await sql`select * from background_job where method = ${method} and job_status = 'queued'`).length
const enabled = async (person: string | null) => (await sql`select enabled from person where row_id = ${person}`)[0].enabled as boolean

async function link(person: string | null, value: string) {
  const [system] = await sql`select 1 from identifier_system where row_id = ${SYSTEM}`
  if (!system) await sql`insert into identifier_system (row_id, label, kind, sensitivity, match, enabled) values (${SYSTEM}, 'Jobs proof code', 'employee-record', 'Restricted', 'Off', true)`
  await sql`insert into person_identifier ${sql({ id: newIdentifierId(), person_id: person, system: SYSTEM, assigner: '', value, valid: '[2020-01-01,)',
    verified: true, one_holder: false, one_per_person: false, source: 'test', recorded_by: 'test' } as unknown as Record<string, never>)}`
}

describe('an app declares its scheduled jobs', () => {
  test('installing gives each job its own Scheduled Job row, under the app-prefixed name, with the declared default', async ({ admin }) => {
    expect(await discoverPackages([await writeApp({ jobs: [sweep, overreach] })])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    expect(await row(SWEEP)).toMatchObject({ row_id: SWEEP, cadence: 'daily', enabled: true, owner_app: APP, description: sweep.description })
    expect(await row(OVERREACH)).toMatchObject({ cadence: 'hourly', owner_app: APP })
    expect(await queued(SWEEP)).toBe(1)
  })

  test('a job runs as its own actor: it disables people, never a System Manager, and mails the System Managers', async ({ admin, createUser }) => {
    expect(await discoverPackages([await writeApp({ jobs: [sweep] })])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    const leaver = await createUser({ email: 'leaver@example.test', roles: [] })
    const stayer = await createUser({ email: 'stayer@example.test', roles: [] })
    const boss = await createUser({ email: 'boss@example.test', roles: ['System Manager'] })
    await link(leaver.user, 'LEFT')
    await link(stayer.user, 'HERE')
    await link(boss.user, 'LEFT')
    await runDue()
    expect(await enabled(leaver.user)).toBe(false)
    expect(await enabled(stayer.user)).toBe(true)
    expect(await enabled(boss.user)).toBe(true)
    // The save is recorded as the job, not as a person or as Administrator.
    expect((await sql`select updated_by from person where row_id = ${leaver.user}`)[0].updated_by).toBe(SWEEP)
    expect(await sql`select operation from activity_log where "user" = ${SWEEP}`).toEqual([{ operation: `disabled ${leaver.user}: their code says they left` }])
    expect(await sql`select recipient from email_queue where subject = 'Sweep summary'`).toEqual([{ recipient: 'boss@example.test' }])
    expect(await row(SWEEP)).toMatchObject({ last_outcome: 'success', last_result: 'disabled 1; mailed 1' })
  })

  test('a write the job did not declare is refused, recorded, and not retried', async ({ admin, createUser }) => {
    expect(await discoverPackages([await writeApp({ jobs: [overreach] })])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    const target = await createUser({ email: 'target@example.test', roles: [] })
    await runDue()
    expect(calls()).toEqual([{ job: OVERREACH, tried: expect.any(String) }])
    expect(await enabled(target.user)).toBe(true)
    const [run] = await sql`select outcome, error, attempt from job_execution where method = ${OVERREACH}`
    expect(run).toEqual({ outcome: 'error', attempt: 1, error: `The job ${OVERREACH} has not declared the grant disable_people` })
    expect(await sql`select "user", operation, method from access_log where "user" = ${OVERREACH}`)
      .toEqual([{ user: OVERREACH, operation: 'app_access_denied', method: `${OVERREACH}:disable_people` }])
    // The schedule carries on; the refused run is not retried a minute later.
    expect((await sql`select job_status from background_job where method = ${OVERREACH} order by created_at`).map((r) => r.job_status)).toEqual(['failed', 'queued'])
  })

  test('a job that declines to act ends its run as refused', async ({ admin }) => {
    const hold: Job = { name: 'hold', cadence: 'daily', description: 'Refuses on a stale feed.' }
    expect(await discoverPackages([await writeApp({ jobs: [hold] })])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    await runDue()
    expect(await row(`${APP}.hold`)).toMatchObject({ last_outcome: 'refused', last_result: 'the feed is stale' })
  })

  test('a job of an app that is not set up yet is refused without running its handler', async ({ admin }) => {
    const hold: Job = { name: 'hold', cadence: 'daily', description: 'Refuses on a stale feed.' }
    expect(await discoverPackages([await writeApp({ jobs: [hold], settings: [{ name: 'feed_id', required: true }] })])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    await runDue()
    expect(calls()).toEqual([])
    expect(await row(`${APP}.hold`)).toMatchObject({ last_outcome: 'refused', last_result: expect.stringContaining('is not set up yet') })
  })

  test('the job actor holds no role outside its grants', async ({ admin }) => {
    expect(await discoverPackages([await writeApp({ jobs: [sweep] })])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    const { getRoles } = await import('../src/permissions')
    expect(await getRoles(SWEEP)).toEqual(['All'])
  })
})

describe("a job follows its app's lifecycle", () => {
  test('disabling the app stops its jobs; enabling it starts them again; the row is kept throughout', async ({ admin }) => {
    expect(await discoverPackages([await writeApp({ jobs: [sweep] })])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    await admin.post('/api/set_app_enabled', { name: APP, enabled: false })
    expect(await queued(SWEEP)).toBe(0)
    expect(await row(SWEEP)).toMatchObject({ enabled: true })
    await runDue()
    expect(calls()).toEqual([])
    // Even a run queued by hand does not reach a disabled app's handler.
    await sql`insert into background_job (row_id, method, payload, job_status, attempts, max_attempts, run_at, trigger)
      values ('fbjobs-manual', ${SWEEP}, '{}', 'queued', 0, 3, now(), 'manual')`
    await runDue()
    expect(calls()).toEqual([])
    expect((await sql`select job_status from background_job where row_id = 'fbjobs-manual'`)[0].job_status).toBe('failed')
    await admin.post('/api/set_app_enabled', { name: APP, enabled: true })
    expect(await queued(SWEEP)).toBe(1)
    await runDue()
    expect(calls()).toEqual([{ job: SWEEP, gone: [] }])
  })

  test('enabling the app re-creates a job row that was deleted while it was off', async ({ admin }) => {
    expect(await discoverPackages([await writeApp({ jobs: [sweep] })])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    await admin.post('/api/set_app_enabled', { name: APP, enabled: false })
    await sql`delete from scheduled_job where method = ${SWEEP}`
    await admin.post('/api/set_app_enabled', { name: APP, enabled: true })
    expect(await row(SWEEP)).toMatchObject({ owner_app: APP, cadence: 'daily', enabled: true })
  })

  test('an upgrade adds, changes and removes jobs as the new manifest says, once it is activated', async ({ admin }) => {
    const v1 = await writeApp({ jobs: [sweep, overreach] })
    expect(await discoverPackages([v1])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    const v2 = await writeApp({ version: '2.0.0',
      jobs: [{ ...sweep, cadence: 'hourly', description: 'Hourly now.' }, { name: 'tidy', cadence: 'every 4 hours', description: 'Tidy notes.' }],
      migrations: [{ id: 'jobs_v2', fromVersion: '1.0.0', toVersion: '2.0.0', operations: [] }] })
    expect(await discoverPackages([v1, v2])).toEqual([])
    const plan = await admin.post('/api/preview_app_upgrade', { name: APP, version: '2.0.0' }) as { planId: string; jobs: unknown[] }
    expect(plan.jobs).toEqual([
      { change: { name: 'sweep', cadence: 'hourly', description: 'Hourly now.' } },
      { add: { name: 'tidy', cadence: 'every 4 hours', description: 'Tidy notes.', grants: [] } },
      { remove: { name: 'overreach' } },
    ])
    await admin.post('/api/upgrade_app', { name: APP, version: '2.0.0', planId: plan.planId })
    expect(await row(SWEEP)).toMatchObject({ cadence: 'hourly', description: 'Hourly now.' })
    expect(await row(`${APP}.tidy`)).toMatchObject({ owner_app: APP, cadence: 'every 4 hours' })
    expect(await row(OVERREACH)).toBeUndefined()
    // Waiting for activation, like the rest of the app.
    expect(await queued(`${APP}.tidy`)).toBe(0)
    await admin.post('/api/activate_app_upgrade', { name: APP, version: '2.0.0' })
    expect(await queued(`${APP}.tidy`)).toBe(1)
    const [entry] = await sql`select repeat_every from background_job where method = ${SWEEP} and job_status = 'queued'`
    expect(Number(entry.repeat_every)).toBe(3600)
  })

  test("an upgrade keeps an administrator's own cadence", async ({ admin }) => {
    const v1 = await writeApp({ jobs: [sweep] })
    expect(await discoverPackages([v1])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    await admin.post('/api/save_row', { table: 'Scheduled Job', row: { row_id: SWEEP, cadence: 'every 15 minutes', updated_at: (await row(SWEEP)).updated_at } })
    const v2 = await writeApp({ version: '2.0.0', jobs: [{ ...sweep, cadence: 'hourly' }],
      migrations: [{ id: 'jobs_v2', fromVersion: '1.0.0', toVersion: '2.0.0', operations: [] }] })
    await discoverPackages([v1, v2])
    const plan = await admin.post('/api/preview_app_upgrade', { name: APP, version: '2.0.0' }) as { planId: string }
    await admin.post('/api/upgrade_app', { name: APP, version: '2.0.0', planId: plan.planId })
    expect(await row(SWEEP)).toMatchObject({ cadence: 'every 15 minutes' })
  })

  test('an upgrade may not give a job a grant it did not have', async ({ admin }) => {
    const v1 = await writeApp({ jobs: [overreach] })
    expect(await discoverPackages([v1])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    const v2 = await writeApp({ version: '2.0.0', jobs: [{ ...overreach, grants: ['read_people', 'disable_people'] }],
      migrations: [{ id: 'jobs_v2', fromVersion: '1.0.0', toVersion: '2.0.0', operations: [] }] })
    await discoverPackages([v1, v2])
    await expectApiError(admin.post('/api/preview_app_upgrade', { name: APP, version: '2.0.0' }),
      { status: 417, message: expect.stringContaining(`The job ${OVERREACH} would gain disable_people; a job cannot gain access in an upgrade`) })
  })

  test('removing the app removes its jobs and their pending runs', async ({ admin }) => {
    expect(await discoverPackages([await writeApp({ jobs: [sweep, overreach] })])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    await uninstallApp(APP)
    expect(await sql`select method from scheduled_job where owner_app = ${APP}`).toEqual([])
    expect(await queued(SWEEP)).toBe(0)
    expect(await queued(OVERREACH)).toBe(0)
  })
})

describe('a job name belongs to one owner', () => {
  test("a name Featherbase already schedules is refused, and the install leaves nothing behind", async ({ admin }) => {
    await sql`insert into scheduled_job (row_id, method, cadence, enabled, description) values (${SWEEP}, ${SWEEP}, 'daily', false, 'A platform job.')`
    expect(await discoverPackages([await writeApp({ jobs: [sweep] })])).toEqual([])
    await expectApiError(admin.post('/api/install_app', { name: APP }),
      { status: 409, message: expect.stringContaining(`The job ${SWEEP} is already a scheduled job of Featherbase`) })
    expect(await sql`select 1 from installed_app where name = ${APP}`).toEqual([])
    expect(await row(SWEEP)).toMatchObject({ owner_app: null, description: 'A platform job.' })
  })

  test("another app's job is refused", async ({ admin }) => {
    await sql`insert into scheduled_job (row_id, method, cadence, enabled, description, owner_app) values (${SWEEP}, ${SWEEP}, 'daily', true, 'Theirs.', 'otherapp')`
    expect(await discoverPackages([await writeApp({ jobs: [sweep] })])).toEqual([])
    await expectApiError(admin.post('/api/install_app', { name: APP }),
      { status: 409, message: expect.stringContaining(`The job ${SWEEP} is already a scheduled job of the app otherapp`) })
  })

  test('an app whose job would take a handler Featherbase registered is rejected when its files load', async ({ admin: _admin }) => {
    registerJob('fbjobsb.sweep', async () => {})
    expect(await discoverPackages([await writeApp({ name: 'fbjobsb', jobs: [sweep] })])).toEqual([
      { path: expect.any(String), error: 'The job sweep would be registered as fbjobsb.sweep, which Featherbase already uses' },
    ])
    expect(packageFailures).toHaveLength(1)
  })

  test('the manifest is checked: a made-up cadence or grant, or a handler the server module does not export', async ({ admin: _admin }) => {
    const failures = async (jobs: Job[]) => (await discoverPackages([await writeApp({ jobs })])).map((f) => f.error)
    expect((await failures([{ ...sweep, cadence: 'fortnightly' }]))[0]).toContain("A job's cadence must be one of every minute, every 15 minutes, hourly, every 4 hours, daily")
    expect((await failures([{ ...sweep, grants: ['delete_everything'] }]))[0]).toContain('A job grant must be one of read_people, disable_people, email_system_managers')
    expect(await failures([{ ...sweep, name: 'missing' }])).toEqual(['Package handlers and authorization callbacks must match declared names'])
    expect(await failures([{ ...overreach, grants: [], identifiers: [SYSTEM] }])).toEqual(['The job overreach names identifier systems, which only a job granted read_people reads'])
  })
})

describe('the instance settings file sets a job\'s cadence', () => {
  test('a dry run shows the change, the apply makes it, and Admin then shows the cadence locked', async ({ admin }) => {
    expect(await discoverPackages([await writeApp({ jobs: [sweep] })])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    const file = { settings: { 'Scheduled Job': [{ row_id: SWEEP, cadence: 'every 4 hours', enabled: false }] } }
    const preview = await applyInstanceSettings(file, { by: 'Administrator', dryRun: true })
    expect(preview.changes).toEqual([
      { table: 'Scheduled Job', row_id: SWEEP, field: 'cadence', old: 'daily', new: 'every 4 hours' },
      { table: 'Scheduled Job', row_id: SWEEP, field: 'enabled', old: true, new: false },
    ])
    expect(await row(SWEEP)).toMatchObject({ cadence: 'daily' })
    await applyInstanceSettings(file, { by: 'Administrator' })
    expect(await row(SWEEP)).toMatchObject({ cadence: 'every 4 hours', enabled: false })
    expect(await admin.get(`/api/instance-settings/managed/Scheduled%20Job/${SWEEP}`)).toMatchObject({ fields: ['cadence', 'enabled'] })
    await expectApiError(admin.post('/api/save_row', { table: 'Scheduled Job', row: { row_id: SWEEP, cadence: 'hourly', updated_at: (await row(SWEEP)).updated_at } }),
      { status: 403, message: expect.stringContaining('Cadence on Scheduled Job fbjobsa.sweep is set in the instance settings file') })
  })

  test('a cadence that is not on the list is refused and nothing changes', async ({ admin: _admin }) => {
    const file = { settings: { 'Scheduled Job': [{ row_id: 'check_sla', cadence: 'fortnightly' }] } }
    const error = await applyInstanceSettings(file, { by: 'Administrator' }).catch((e: unknown) => e) as { fields?: Record<string, string> }
    expect(Object.keys(error.fields ?? {})).toEqual(['Scheduled Job.check_sla.cadence'])
    expect(await row('check_sla')).toMatchObject({ cadence: 'every minute' })
  })
})
