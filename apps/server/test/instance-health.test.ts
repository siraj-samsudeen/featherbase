// Instance health (#465, design D8; spec instance-health): small check
// functions, the same list printed at release, served to the health page and
// banner, and run every 15 minutes by a scheduled job that records only
// changes of state.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { hashPassword } from '../src/auth'
import { saveDoc } from '../src/document'
import { withNamedVariable, withVariable } from '../src/env'
import { applyInstanceSettings } from '../src/instance-settings'
import { BREAK_GLASS_ACTOR } from '../src/managed-settings'
import { runAsSystemActor } from '../src/system-actor'
import { drainJobs, enqueue, loadJobs } from '../src/jobs'
import {
  HEALTH_CHECK_JOB,
  formatHealthReport,
  instanceHealth,
  recordHealthTransitions,
  runHealthChecks,
  type HealthCheck,
} from '../src/instance-health'

const byKey = (checks: HealthCheck[], key: string) => {
  const found = checks.find((c) => c.key === key)
  if (!found) throw new Error(`no check ${key} in ${checks.map((c) => c.key).join(', ')}`)
  return found
}

/** Nobody but the built-in Administrator is a System Manager with an address. */
async function noManagerEmails() {
  await sql`update person set email = null where row_id in (
    select parent from has_role where role = 'System Manager')`
}

async function apply(file: unknown = { settings: { 'System Settings': { app_name: 'Health Name' } } }) {
  return applyInstanceSettings(file, { by: 'Administrator' })
}

describe('the checks (5.1)', () => {
  test('a System Manager with an email address: failing with none, passing once one has an address', async ({ createUser }) => {
    await noManagerEmails()
    const failing = byKey(await runHealthChecks(), 'system-manager-email')
    expect(failing).toMatchObject({ ok: false, severity: 'error' })
    expect(failing.message).toContain('No System Manager has an email address')
    expect(failing.fix).toBeTruthy()

    await createUser({ email: 'keeper@example.com', roles: ['System Manager'] })
    const passing = byKey(await runHealthChecks(), 'system-manager-email')
    expect(passing).toMatchObject({ ok: true })
    expect(passing.message).toContain('1 System Manager')
  })

  test('a disabled System Manager with an address does not count', async ({ createUser }) => {
    await noManagerEmails()
    const keeper = await createUser({ email: 'gone@example.com', roles: ['System Manager'] })
    await sql`update person set enabled = false where row_id = ${keeper.user}`
    expect(byKey(await runHealthChecks(), 'system-manager-email').ok).toBe(false)
  })

  test('recommended variables: a warning naming the missing variable outside development, passing when set', async () => {
    await withVariable('FILE_STORAGE_DIR', '', async () => {
      const missing = byKey(await runHealthChecks({ environment: 'production' }), 'recommended-variables')
      expect(missing).toMatchObject({ ok: false, severity: 'warning' })
      expect(missing.message).toContain('FILE_STORAGE_DIR')
    })
    await withVariable('FILE_STORAGE_DIR', '/data/files', async () => {
      const set = byKey(await runHealthChecks({ environment: 'production' }), 'recommended-variables')
      expect(set.ok).toBe(true)
    })
  })

  test('a variable the settings made required is an error on production, not a pass (Codex review)', async () => {
    await sql`update sign_in_method set enabled = true, client_id = 'a-client-id' where kind = 'google'`
    await withVariable('GOOGLE_CLIENT_SECRET', '', async () => {
      const check = byKey(await runHealthChecks({ environment: 'production' }), 'recommended-variables')
      expect(check).toMatchObject({ ok: false, severity: 'error' })
      expect(check.message).toContain('GOOGLE_CLIENT_SECRET')
    })
  })

  test('settings file applied: failing and saying how to apply it before the first apply, passing after', async () => {
    await sql`delete from instance_settings_apply`
    const never = byKey(await runHealthChecks(), 'settings-applied')
    expect(never).toMatchObject({ ok: false, severity: 'error' })
    expect(never.message).toBe('The settings were never applied.')
    expect(never.fix).toContain('cli settings:apply --file')

    await apply()
    const applied = byKey(await runHealthChecks(), 'settings-applied')
    expect(applied.ok).toBe(true)
    expect(applied.message).toContain('Administrator')
  })

  test('settings match the file: nothing to compare before an apply; failing after a break-glass change, naming the field', async () => {
    await sql`delete from instance_settings_apply`
    expect(byKey(await runHealthChecks(), 'settings-match-file')).toMatchObject({ ok: true })

    await apply()
    expect(byKey(await runHealthChecks(), 'settings-match-file')).toMatchObject({ ok: true })

    await runAsSystemActor(BREAK_GLASS_ACTOR, () => saveDoc('System Settings', { app_name: 'Hand Fixed' }, BREAK_GLASS_ACTOR))
    const drifted = byKey(await runHealthChecks(), 'settings-match-file')
    expect(drifted).toMatchObject({ ok: false, severity: 'warning' })
    expect(drifted.message).toContain('System Settings app_name')

    // Applying the file again brings it back.
    await apply()
    expect(byKey(await runHealthChecks(), 'settings-match-file').ok).toBe(true)
  })

  test('settings match the file: an apply recorded before values were kept asks for one more apply', async () => {
    await apply()
    await sql`update instance_settings_apply set managed_values = null`
    const unknown = byKey(await runHealthChecks(), 'settings-match-file')
    expect(unknown).toMatchObject({ ok: false, severity: 'warning' })
    expect(unknown.fix).toContain('Apply the file again')
  })

  test('scheduled jobs: one check per job; the last run failing fails it until a later run succeeds', async () => {
    const now = new Date()
    await sql`update scheduled_job set enabled = true, last_run_at = ${now}, last_outcome = 'success' where method = 'disable_leavers'`
    expect(byKey(await runHealthChecks({ now }), 'scheduled-job:disable_leavers')).toMatchObject({ ok: true, title: 'Scheduled job: disable_leavers' })

    await sql`update scheduled_job set last_outcome = 'error' where method = 'disable_leavers'`
    await sql`insert into job_execution (row_id, created_by, updated_by, job, method, attempt, outcome, error, started_at)
      values ('hc-exec-1', 'Administrator', 'Administrator', 'x', 'disable_leavers', 1, 'error', 'the warehouse feed is stale', ${now})`
    const failed = byKey(await runHealthChecks({ now }), 'scheduled-job:disable_leavers')
    expect(failed).toMatchObject({ ok: false, severity: 'error' })
    expect(failed.message).toContain('the warehouse feed is stale')

    await sql`update scheduled_job set last_outcome = 'success' where method = 'disable_leavers'`
    expect(byKey(await runHealthChecks({ now }), 'scheduled-job:disable_leavers').ok).toBe(true)
  })

  test('scheduled jobs: a switched-off job passes; an enabled one that stopped running fails', async () => {
    const now = new Date()
    await sql`update scheduled_job set enabled = false, last_outcome = 'error' where method = 'disable_leavers'`
    const off = byKey(await runHealthChecks({ now }), 'scheduled-job:disable_leavers')
    expect(off).toMatchObject({ ok: true, message: 'Switched off.' })

    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000)
    await sql`update scheduled_job set enabled = true, last_outcome = 'success', last_run_at = ${threeDaysAgo} where method = 'disable_leavers'`
    const stale = byKey(await runHealthChecks({ now }), 'scheduled-job:disable_leavers')
    expect(stale).toMatchObject({ ok: false, severity: 'error' })
    expect(stale.message).toContain('has not run since')
  })

  test('scheduled jobs: a cadence the worker does not know fails, and a job switched on long ago that never ran says so', async () => {
    const now = new Date()
    await sql`update scheduled_job set enabled = true, cadence = 'every fortnight' where method = 'disable_leavers'`
    const unknown = byKey(await runHealthChecks({ now }), 'scheduled-job:disable_leavers')
    expect(unknown).toMatchObject({ ok: false, severity: 'error' })
    expect(unknown.message).toBe('Its cadence "every fortnight" is not one the worker knows, so it never runs.')
    expect(unknown.fix).toContain('choose one of the listed cadences')

    const longAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
    await sql`update scheduled_job set cadence = 'daily', last_run_at = null, last_outcome = null, updated_at = ${longAgo} where method = 'disable_leavers'`
    const never = byKey(await runHealthChecks({ now }), 'scheduled-job:disable_leavers')
    expect(never).toMatchObject({ ok: false, severity: 'error' })
    expect(never.message).toContain('has not run since it was switched on')

    await sql`update scheduled_job set updated_at = ${now} where method = 'disable_leavers'`
    expect(byKey(await runHealthChecks({ now }), 'scheduled-job:disable_leavers')).toMatchObject({ ok: true, message: 'Has not run yet.' })
  })

  test('the Administrator default password: failing outside development and test, passing once rotated', async () => {
    await sql`update person set password_hash = ${hashPassword('admin')} where row_id = 'Administrator'`
    const weak = byKey(await runHealthChecks({ environment: 'production' }), 'administrator-password')
    expect(weak).toMatchObject({ ok: false, severity: 'error' })
    expect(weak.message).toContain('known default password remains active')
    expect(byKey(await runHealthChecks({ environment: 'test' }), 'administrator-password').ok).toBe(true)

    await sql`update person set password_hash = ${hashPassword('a-long-rotated-secret')} where row_id = 'Administrator'`
    expect(byKey(await runHealthChecks({ environment: 'production' }), 'administrator-password').ok).toBe(true)
  })

  test('an app missing a required setting or secret: one failing check per app, naming what is missing', async () => {
    const manifest = { name: 'healthapp', title: 'Health app', settings: [{ name: 'report_id', required: true }], secrets: ['HEALTHAPP_TOKEN'] }
    await sql`insert into installed_app (name, manifest, enabled, runtime_package) values ('healthapp', ${sql.json(manifest)}, true, true)`
    const failing = byKey(await withNamedVariable('HEALTHAPP_TOKEN', undefined, () => runHealthChecks()), 'app-setup:healthapp')
    expect(failing).toMatchObject({ ok: false, severity: 'warning', title: 'App set up: Health app',
      message: 'Health app answers "not set up yet": missing setting report_id, secret HEALTHAPP_TOKEN.' })
    await sql`insert into app_setting (row_id, app, setting, value) values ('healthapp.report_id', 'healthapp', 'report_id', 'R-1')`
    const passing = byKey(await withNamedVariable('HEALTHAPP_TOKEN', 'health-token-620', () => runHealthChecks()), 'app-setup:healthapp')
    expect(passing).toMatchObject({ ok: true, fix: null })
    expect(JSON.stringify(passing)).not.toMatch(/R-1|health-token-620/)
  })

  test('every check names why it matters, and a failing one says how to fix it', async () => {
    await sql`delete from instance_settings_apply`
    for (const check of await runHealthChecks()) {
      expect(check.title, check.key).toMatch(/^[A-Z]/)
      expect(check.why, check.key).toBeTruthy()
      if (!check.ok) expect(check.fix, check.key).toBeTruthy()
    }
  })

  test('the release prints every check, failing ones as warnings', async () => {
    await sql`delete from instance_settings_apply`
    const lines = formatHealthReport(await runHealthChecks())
    const applied = lines.find((l) => l.text.includes('Settings file applied'))
    expect(applied).toMatchObject({ failing: true })
    expect(applied!.text).toMatch(/^health: FAILING \(error\) Settings file applied: The settings were never applied\./)
    expect(lines.some((l) => !l.failing && l.text.startsWith('health: passing '))).toBe(true)
  })
})

// The sandbox freezes now() at BEGIN while enqueue stamps run_at from the
// wall clock, so a "due now" entry is nudged onto the transaction clock.
async function drainDue() {
  await sql`update background_job set run_at = now() where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
  return drainJobs()
}

describe('history: only changes of state are recorded (5.2)', () => {
  const events = (key: string) => sql`select ok, message from health_check_event where check_key = ${key} order by at, id`

  test('the first observation is recorded, a steady check writes nothing, and a flip writes one row', async () => {
    await sql`delete from health_check_event`
    const t0 = new Date('2026-10-26T03:00:00Z')
    const check = (ok: boolean): HealthCheck => ({
      key: 'probe', title: 'Probe', ok, severity: 'error', message: ok ? 'Fine.' : 'Broken.', why: 'w', fix: ok ? null : 'f',
    })
    expect(await recordHealthTransitions([check(true)], t0)).toBe(1)
    expect(await recordHealthTransitions([check(true)], new Date(t0.getTime() + 900_000))).toBe(0)
    expect(await recordHealthTransitions([check(false)], new Date(t0.getTime() + 1_800_000))).toBe(1)
    expect(await recordHealthTransitions([check(false)], new Date(t0.getTime() + 2_700_000))).toBe(0)
    expect(await events('probe')).toEqual([
      { ok: true, message: 'Fine.' },
      { ok: false, message: 'Broken.' },
    ])
  })

  test('a problem that came and went at night shows as failing for that hour', async () => {
    await sql`delete from health_check_event`
    const at = (h: number) => new Date(Date.UTC(2026, 9, 26, h - 5, 30)) // IST hours
    const job = 'scheduled-job:disable_leavers'
    const base = { key: job, title: 'Scheduled job: disable_leavers', severity: 'error' as const, why: 'w' }
    await recordHealthTransitions([{ ...base, ok: true, message: 'Last run succeeded.', fix: null }], at(1))
    await recordHealthTransitions([{ ...base, ok: false, message: 'Last run failed.', fix: 'f' }], at(2))
    await recordHealthTransitions([{ ...base, ok: true, message: 'Last run succeeded.', fix: null }], at(3))
    const health = await instanceHealth({ record: false })
    const card = health.checks.find((c) => c.key === job)!
    expect(card.history.map((h) => ({ ok: h.ok, from: h.from, until: h.until }))).toEqual([
      { ok: true, from: at(3).toISOString(), until: null },
      { ok: false, from: at(2).toISOString(), until: at(3).toISOString() },
      { ok: true, from: at(1).toISOString(), until: at(2).toISOString() },
    ])
  })

  test('the scheduled job runs every 15 minutes, records the checks, and a second run writes nothing', async () => {
    await loadJobs()
    const [row] = await sql`select cadence, enabled from scheduled_job where method = ${HEALTH_CHECK_JOB}`
    expect(row).toMatchObject({ cadence: 'every 15 minutes', enabled: true })

    await sql`delete from background_job`
    await sql`delete from health_check_event`
    await enqueue(HEALTH_CHECK_JOB, {}, { trigger: 'manual' })
    expect(await drainDue()).toBe(1)
    const [{ n: first }] = await sql`select count(*)::int as n from health_check_event`
    expect(first).toBeGreaterThan(0)
    const [exec] = await sql`select outcome, result from job_execution where method = ${HEALTH_CHECK_JOB} order by started_at desc limit 1`
    expect(exec.outcome).toBe('success')
    expect(exec.result).toMatch(/checks? (pass|fail)/)

    await enqueue(HEALTH_CHECK_JOB, {}, { trigger: 'manual' })
    await drainDue()
    const [{ n: second }] = await sql`select count(*)::int as n from health_check_event`
    // Its own scheduled-job check may flip once (it has now run); nothing else does.
    expect(second - first).toBeLessThanOrEqual(1)
  })
})

describe('the health API (5.3, 5.4)', () => {
  test('a System Manager sees every check with its history; the count is the failing checks', async ({ admin }) => {
    await sql`delete from instance_settings_apply`
    await sql`delete from health_check_event`
    const health = await admin.get<{
      checks: (HealthCheck & { since: string | null; history: { ok: boolean }[] })[]
      failing: number
      worst: string | null
    }>('/api/instance-health')
    const applied = health.checks.find((c) => c.key === 'settings-applied')!
    expect(applied).toMatchObject({ ok: false, message: 'The settings were never applied.' })
    expect(applied.history).toHaveLength(1)
    expect(applied.since).toBeTruthy()
    expect(health.failing).toBe(health.checks.filter((c) => !c.ok).length)
    expect(health.worst).toBe('error')
    // Failing first, red before amber.
    const firstPassing = health.checks.findIndex((c) => c.ok)
    expect(health.checks.slice(firstPassing).every((c) => c.ok)).toBe(true)
  })

  test('anyone else is refused', async ({ createUser }) => {
    const person = await createUser({ roles: ['All'] })
    await expect(person.get('/api/instance-health')).rejects.toMatchObject({ status: 403 })
  })
})
