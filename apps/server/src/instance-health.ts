// Instance health (#465, design D8; spec instance-health). Each check is a
// small function returning { ok, severity, message, fix }. The same list is
// printed by the release step, served to the health page and the banner, and
// run every 15 minutes by the `check_instance_health` scheduled job.
// health_check_event keeps only changes of state, so a check that stays the
// same writes nothing and the timeline costs almost nothing to keep.
import { fmtInstantIST } from 'shared'
import { sql, withTransaction } from './db'
import { config } from './config'
import { verifyPassword } from './auth'
import { cadenceSeconds } from './jobs'
import { checkVariables, DEV_ENVIRONMENTS } from './env'
import { lastApply } from './managed-settings'
import { systemManagerEmails } from './system-notice'
import { appSetupState } from './app-settings'

export const HEALTH_CHECK_JOB = 'check_instance_health'

export type HealthSeverity = 'error' | 'warning'

export interface HealthCheck {
  /** Stable identity: the history is keyed on it. */
  key: string
  /** What is checked, in sentence case. */
  title: string
  ok: boolean
  /** How bad it is while failing (the banner takes the worst). */
  severity: HealthSeverity
  /** What is true now. */
  message: string
  /** Why the check exists. */
  why: string
  /** How to make it pass; null while it passes. */
  fix: string | null
}

interface HealthCheckOptions {
  /** The environment to judge against (default: this process's). */
  environment?: string
  /** The time to judge a job's last run against (default: now). */
  now?: Date
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// ---------------------------------------------------------------- the checks

async function systemManagerEmail(): Promise<HealthCheck> {
  const emails = await systemManagerEmails()
  const base = {
    key: 'system-manager-email',
    title: 'A System Manager with an email address',
    severity: 'error' as const,
    why: 'System notices (the leaver-check summary, waiting-for-access alerts) go to System Managers by email. With no address they reach nobody.',
  }
  if (emails.length)
    return {
      ...base,
      ok: true,
      message: `${emails.length} ${plural(emails.length, 'System Manager has an email address', 'System Managers have email addresses')} and ${plural(emails.length, 'receives', 'receive')} system notices.`,
      fix: null,
    }
  return {
    ...base,
    ok: false,
    message: 'No System Manager has an email address, so system notices reach nobody.',
    fix: 'Give a System Manager an email address on their Person page, or give the System Manager role to a person who has one.',
  }
}

async function recommendedVariables(environment: string): Promise<HealthCheck> {
  const { settingsRequirements } = await import('./release-preflight')
  const report = checkVariables({ environment, ...(await settingsRequirements()) })
  // A refusal here is a variable the stored settings made required after the
  // server started (Google sign-in turned on in Admin without its secret):
  // the release would refuse it, so it is an error, not a warning (Codex review).
  // Only those the settings added: the server cannot be running without the
  // ones every server needs.
  const always = new Set(checkVariables({ environment }).refusals)
  const refused = report.refusals.filter((r) => !always.has(r))
  const missing = [...refused, ...report.warnings.map((w) => w.replace(/^WARNING:\s*/, ''))]
  const base = {
    key: 'recommended-variables',
    title: 'Recommended deployment variables',
    severity: (refused.length ? 'error' : 'warning') as HealthSeverity,
    why: 'A missing recommended variable does not stop the server, but the part that needs it falls back to a default that may not suit a hosted instance.',
  }
  if (!missing.length) return { ...base, ok: true, message: 'Every recommended variable is set.', fix: null }
  return {
    ...base,
    ok: false,
    message: missing.join(' '),
    fix: 'Set the variable on the host (on Railway, the service\'s Variables), then redeploy. docs/DEPLOY.md, "Configuration", lists each one.',
  }
}

async function principalName(id: string): Promise<string> {
  const [row] = await sql`
    select coalesce(
      (select nullif(trim(full_name), '') from person where row_id = ${id}),
      (select nullif(trim(label), '') from service_account where row_id = ${id})) as name`
  return (row?.name as string | null) ?? 'an unnamed principal'
}

const APPLY_FIX =
  'Apply the instance\'s settings file: run the apply workflow in the instance repository, or run `cli settings:apply --file instance-settings.json --environment <name>` on this server. docs/DEPLOY.md, "Instance settings".'

async function settingsApplied(): Promise<HealthCheck> {
  const apply = await lastApply()
  const base = {
    key: 'settings-applied',
    title: 'Settings file applied',
    severity: 'error' as const,
    why: 'The settings file in the instance repository decides this instance\'s settings. Until it is applied, they are whatever was set by hand, and none of them is locked.',
  }
  if (!apply) return { ...base, ok: false, message: 'The settings were never applied.', fix: APPLY_FIX }
  const parts = [
    `Last applied ${fmtInstantIST(new Date(apply.applied_at))} by ${await principalName(apply.applied_by)}`,
    apply.environment ? `for ${apply.environment}` : null,
    apply.revision ? `from revision ${apply.revision}` : null,
  ].filter(Boolean)
  return { ...base, ok: true, message: `${parts.join(' ')}.`, fix: null }
}

async function settingsMatchFile(): Promise<HealthCheck> {
  const base = {
    key: 'settings-match-file',
    title: 'Settings match the file',
    severity: 'warning' as const,
    why: 'The file is the record of this instance\'s settings. A value changed outside it is lost at the next apply, and missing from the file\'s history.',
  }
  if (!(await lastApply())) return { ...base, ok: true, message: 'Nothing to compare until the settings file is applied.', fix: null }
  const { settingsDrift } = await import('./instance-settings')
  const drift = await settingsDrift()
  if (drift === null)
    return {
      ...base,
      ok: false,
      message: 'The last apply did not record the values it set, so a change since then cannot be detected.',
      fix: 'Apply the file again; from then on every change is compared.',
    }
  if (!drift.length) return { ...base, ok: true, message: 'Every setting the file manages has the value it set.', fix: null }
  const names = drift.map((d) => (d.row_id === d.table ? `${d.table} ${d.field}` : `${d.table} ${d.row_id} ${d.field}`))
  return {
    ...base,
    ok: false,
    message: `${drift.length} ${plural(drift.length, 'setting differs', 'settings differ')} from the file: ${names.join(', ')}.`,
    fix: 'These were changed outside the file (`cli settings:set` is the break-glass way). Put the same values in the settings file and apply it, or apply the file again to put its values back.',
  }
}

/** A job that has not run for twice its cadence, plus ten minutes for a
 *  restart, has stopped. */
const overdueAfterMs = (cadence: string) => (2 * cadenceSeconds(cadence) + 600) * 1000

async function scheduledJobs(now: Date): Promise<HealthCheck[]> {
  const rows = await sql`
    select j.method, j.cadence, j.enabled, j.last_run_at, j.last_outcome, j.last_result, j.updated_at,
      (select e.error from job_execution e where e.method = j.method and e.outcome = 'error'
        order by e.started_at desc nulls last, e.created_at desc limit 1) as last_error
    from scheduled_job j order by j.method`
  return rows.map((r) => {
    const method = String(r.method)
    const base = {
      key: `scheduled-job:${method}`,
      title: `Scheduled job: ${method}`,
      severity: 'error' as const,
      why: 'A scheduled job does its work only when it runs. A failed or stopped run means that work is not being done.',
    }
    if (!r.enabled) return { ...base, ok: true, message: 'Switched off.', fix: null }
    let limit: number
    try {
      limit = overdueAfterMs(String(r.cadence))
    } catch {
      return { ...base, ok: false, message: `Its cadence "${String(r.cadence)}" is not one the worker knows, so it never runs.`, fix: 'Open the job in Admin and choose one of the listed cadences.' }
    }
    const lastRun = r.last_run_at ? new Date(r.last_run_at as string) : null
    const since = lastRun ?? new Date(r.updated_at as string)
    if (now.getTime() - since.getTime() > limit)
      return {
        ...base,
        ok: false,
        message: lastRun
          ? `It runs ${String(r.cadence)} but has not run since ${fmtInstantIST(lastRun)}.`
          : `It runs ${String(r.cadence)} but has not run since it was switched on (${fmtInstantIST(since)}).`,
        fix: 'The background worker may have stopped. Check that the server is running and look at Jobs in Admin; the check passes after the next successful run.',
      }
    if (r.last_outcome === 'error') {
      const error = typeof r.last_error === 'string' && r.last_error.trim() ? `: ${r.last_error.trim().slice(0, 200)}` : '.'
      return {
        ...base,
        ok: false,
        message: `The last run failed${error}`,
        fix: 'Open Jobs in Admin to see the error, fix its cause, then run the job again. The check passes after a run succeeds.',
      }
    }
    // #464: a run that refused to act is treated like a failure.
    if (r.last_outcome === 'refused') {
      const reason = typeof r.last_result === 'string' && r.last_result.trim() ? `: ${r.last_result.trim().slice(0, 200)}` : '.'
      return {
        ...base,
        ok: false,
        message: `The last run refused to act${reason}`,
        fix: 'Open Jobs in Admin to see why, fix its cause, then run the job again. The check passes after a run succeeds.',
      }
    }
    if (!lastRun) return { ...base, ok: true, message: 'Has not run yet.', fix: null }
    return { ...base, ok: true, message: `The last run succeeded (${fmtInstantIST(lastRun)}).`, fix: null }
  })
}

async function administratorPassword(environment: string): Promise<HealthCheck> {
  const base = {
    key: 'administrator-password',
    title: 'Administrator default password',
    severity: 'error' as const,
    why: 'The built-in Administrator is the break-glass login with every right. With the default password, anyone who knows it can sign in as it.',
  }
  if (DEV_ENVIRONMENTS.includes(environment))
    return { ...base, ok: true, message: `Not checked on a ${environment} server, where the default password is expected.`, fix: null }
  const [admin] = await sql`select password_hash from person where row_id = 'Administrator'`
  if (!admin?.password_hash) return { ...base, ok: true, message: 'The Administrator has no password, so it cannot sign in with one.', fix: null }
  if (verifyPassword('admin', String(admin.password_hash)))
    return {
      ...base,
      ok: false,
      message: 'The Administrator\'s known default password remains active.',
      fix: 'Sign in as Administrator and change its password from the account menu. ADMIN_PASSWORD and cli seed never overwrite an existing password. docs/DEPLOY.md, "First admin".',
    }
  return { ...base, ok: true, message: 'The Administrator does not use the default password.', fix: null }
}

/** #620 (E2): one check per enabled app that declares settings or secrets.
 *  Names what is missing, never a value. */
async function appsSetUp(): Promise<HealthCheck[]> {
  return (await appSetupState()).map(({ app, title, missing }) => {
    const base = {
      key: `app-setup:${app}`,
      title: `App set up: ${title}`,
      severity: 'warning' as const,
      why: 'An app that lacks a required setting, secret, data source or identifier system answers "not set up yet" instead of working.',
    }
    if (!missing.length) return { ...base, ok: true, message: `${title} has every setting and secret it requires.`, fix: null }
    return {
      ...base,
      ok: false,
      message: `${title} answers "not set up yet": missing ${missing.join(', ')}.`,
      fix: 'Set each setting in the instance settings file (App Setting) and apply it, set each secret as a deployment variable, add each data source in Admin (Data Source), and add each identifier system in Admin (Identifier System), then restart.',
    }
  })
}

/** Every check, in the page's order. */
export async function runHealthChecks(opts: HealthCheckOptions = {}): Promise<HealthCheck[]> {
  const environment = opts.environment ?? config.environment
  return [
    await systemManagerEmail(),
    await recommendedVariables(environment),
    await settingsApplied(),
    await settingsMatchFile(),
    ...(await scheduledJobs(opts.now ?? new Date())),
    ...(await appsSetUp()),
    await administratorPassword(environment),
  ]
}

/** The release step's lines: every check, failing ones flagged (printed as
 *  warnings, never refusing the release). */
export function formatHealthReport(checks: HealthCheck[]): { text: string; failing: boolean }[] {
  return checks.map((c) =>
    c.ok
      ? { text: `health: passing ${c.title}: ${c.message}`, failing: false }
      : { text: `health: FAILING (${c.severity}) ${c.title}: ${c.message} Fix: ${c.fix}`, failing: true })
}

// ---------------------------------------------------------------- history

const HISTORY_LOCK = 'featherbase.instance_health'

async function holdHistory(): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${HISTORY_LOCK}))`
}

/** Run the checks and record what changed, as one step under the history
 *  lock, timed after the lock is held: an observation that started earlier
 *  can never be recorded after a later one (Codex review). The scheduled job
 *  and the health page both observe through here. */
export async function observeHealth(opts: HealthCheckOptions = {}): Promise<{ checks: HealthCheck[]; recorded: number; at: Date }> {
  return withTransaction(async () => {
    await holdHistory()
    const at = opts.now ?? new Date()
    const checks = await runHealthChecks({ ...opts, now: at })
    const recorded = await recordHealthTransitions(checks, at)
    return { checks, recorded, at }
  })
}

/** Record each check whose state differs from its last recorded one (or that
 *  has none yet). Returns how many rows were written. */
export async function recordHealthTransitions(checks: HealthCheck[], at: Date = new Date()): Promise<number> {
  if (!checks.length) return 0
  return withTransaction(async () => {
    // One writer at a time, so two readers seeing the same flip write it once.
    await holdHistory()
    const keys = checks.map((c) => c.key)
    const last = await sql`
      select distinct on (check_key) check_key, ok from health_check_event
      where check_key in ${sql(keys)} order by check_key, at desc, id desc`
    const known = new Map(last.map((r) => [String(r.check_key), Boolean(r.ok)]))
    const changed = checks.filter((c) => known.get(c.key) !== c.ok)
    if (!changed.length) return 0
    await sql`insert into health_check_event ${sql(changed.map((c) => ({
      check_key: c.key, ok: c.ok, severity: c.severity, message: c.message.slice(0, 1000), at,
    })))}`
    return changed.length
  })
}

interface HealthHistoryEntry {
  ok: boolean
  severity: HealthSeverity
  message: string
  /** When this state began. */
  from: string
  /** When the next state began; null for the current one. */
  until: string | null
}

interface InstanceHealth {
  checks: (HealthCheck & { since: string | null; history: HealthHistoryEntry[] })[]
  /** How many checks are not passing. */
  failing: number
  /** The worst severity among them, or null when every check passes. */
  worst: HealthSeverity | null
  checked_at: string
}

/** How many past states each check shows. */
const HISTORY_LIMIT = 20

/** Run the checks, record what changed (unless `record` is false), and
 *  return them with their history: failing first, errors before warnings. */
export async function instanceHealth(opts: HealthCheckOptions & { record?: boolean } = {}): Promise<InstanceHealth> {
  if (opts.record === false) return describeHealth(opts)
  // The observation and the history it is shown with are one step under the
  // history lock, so a response never pairs these checks with a later
  // observation's history (Codex review). The lock is reentrant, so
  // observeHealth's own hold inside is free.
  return withTransaction(async () => {
    await holdHistory()
    return describeHealth(opts)
  })
}

async function describeHealth(opts: HealthCheckOptions & { record?: boolean }): Promise<InstanceHealth> {
  const observed = opts.record === false
    ? { checks: await runHealthChecks({ ...opts, now: opts.now ?? new Date() }), at: opts.now ?? new Date() }
    : await observeHealth(opts)
  const { checks } = observed
  const now = observed.at
  const rows = await sql`
    select check_key, ok, severity, message, at from (
      select *, row_number() over (partition by check_key order by at desc, id desc) as n
      from health_check_event where check_key in ${sql(checks.map((c) => c.key))}) h
    where n <= ${HISTORY_LIMIT + 1} order by check_key, at desc, id desc`
  const byKey = new Map<string, HealthHistoryEntry[]>()
  for (const r of rows) {
    const list = byKey.get(String(r.check_key)) ?? []
    const from = new Date(r.at as string).toISOString()
    list.push({ ok: Boolean(r.ok), severity: r.severity as HealthSeverity, message: String(r.message), from, until: list.length ? list[list.length - 1].from : null })
    byKey.set(String(r.check_key), list)
  }
  const rank = (c: HealthCheck) => (c.ok ? 2 : c.severity === 'error' ? 0 : 1)
  const ordered = checks.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(({ c }) => c)
  const failing = checks.filter((c) => !c.ok)
  return {
    checks: ordered.map((c) => {
      const history = (byKey.get(c.key) ?? []).slice(0, HISTORY_LIMIT)
      return { ...c, since: history[0]?.from ?? null, history }
    }),
    failing: failing.length,
    worst: failing.some((c) => c.severity === 'error') ? 'error' : failing.length ? 'warning' : null,
    checked_at: now.toISOString(),
  }
}
