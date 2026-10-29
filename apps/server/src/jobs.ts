import { randomBytes } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { sql } from './db'
import { publishUserEvent } from './realtime'
import { activeApps, appOperation } from './app-lifecycle'
import { readVariable } from './env'

// JOB-001/002/003: durable job queue with an in-process worker.
//
// Jobs are named functions in a registry. enqueue() persists a Background
// Job row; the worker claims due jobs (queued + run_at<=now) one at a time,
// runs the handler with at-least-once semantics, retries up to max_attempts,
// logs every attempt as a Job Execution, and re-enqueues recurring jobs.

// Why a queue row exists. 'schedule' is the clock (a Scheduled Job's cadence,
// or the re-enqueue after a recurring run); 'demand' is something that
// happened (an email queued, a webhook fired, a report asked for a dataset
// that had not built); 'manual' is a person on /api/enqueue_job; 'retry' is a
// failed job re-queued. Observability, not behaviour: nothing branches on it.
export const JOB_TRIGGERS = ['schedule', 'demand', 'manual', 'retry'] as const
export type JobTrigger = (typeof JOB_TRIGGERS)[number]

// The cadences a Scheduled Job may choose from. A closed set on purpose:
// "every 4 hours" is a decision an administrator can read and reverse, a
// bare number of seconds is not (data-warehouse #3036 — every hand-typed
// interval that drifted off the fleet grid failed silently).
export const CADENCE_SECONDS: Record<string, number> = {
  'every minute': 60,
  'every 15 minutes': 15 * 60,
  hourly: 60 * 60,
  'every 4 hours': 4 * 60 * 60,
  daily: 24 * 60 * 60,
}
export type Cadence = keyof typeof CADENCE_SECONDS

export function cadenceSeconds(cadence: string): number {
  const seconds = CADENCE_SECONDS[cadence]
  if (!seconds) throw new Error(`Unknown cadence "${cadence}"`)
  return seconds
}

// JOB-005: handlers receive a context that can report progress to the client.
export interface JobContext {
  setProgress: (percent: number, message?: string) => void
  /** A one-line outcome kept on this attempt's Job Execution row, for what
   *  success alone cannot say (e.g. a summary that reached nobody, #463). */
  setResult: (text: string) => void
  /** End this run as refused: the job declined to act (a stale feed, an
   *  implausible batch). Recorded like a failure and alerted (#464), but not
   *  retried — refusing again a minute later helps nobody — and the schedule
   *  carries on. `reason` becomes the run's one-line result. */
  refuse: (reason: string) => void
  /** The queue row being run, and why it exists. */
  job: { row_id: string; trigger: JobTrigger }
}
export type JobHandler = (
  payload: Record<string, unknown>,
  ctx: JobContext,
) => unknown | Promise<unknown>

/** Thrown by a handler whose job cannot succeed by running again: the job
 *  is failed at once, with this message, without spending its other
 *  attempts; a person can still retry it (#334: a refused email). Like
 *  running out of attempts, it ends a recurrence that has no Scheduled Job
 *  row. */
export class FinalJobFailure extends Error {}

const registry = new Map<string, JobHandler>()
// #700: which app registered a method; absent for the platform's own jobs.
const owners = new Map<string, string>()

export function registerJob(method: string, handler: JobHandler, owner?: string): void {
  registry.set(method, handler)
  if (owner) owners.set(method, owner)
  else owners.delete(method)
}

/** #700: who registered `method`: an app's name, 'platform', or null when
 *  nothing has. */
export function jobRegistrant(method: string): string | null {
  if (!registry.has(method)) return null
  return owners.get(method) ?? 'platform'
}

// #700: a Scheduled Job an app declares is live only while that app is:
// enabled, not waiting for an upgrade's activation, and loaded by this
// process. The platform's own rows (no owner) depend on nothing.
const scheduleColumns = () => sql`s.method, s.cadence, s.enabled, s.owner_app,
  (s.owner_app is null or exists (select 1 from installed_app a
    where a.name = s.owner_app and a.enabled and not a.activation_pending)) as owner_on`
function isLive(row: Record<string, unknown>): boolean {
  return Boolean(row.enabled) && Boolean(row.owner_on) && (row.owner_app == null || activeApps.has(String(row.owner_app)))
}

function jobName(): string {
  return randomBytes(6).toString('hex')
}

interface EnqueueOpts {
  maxAttempts?: number
  runAt?: Date
  repeatEvery?: number // seconds; recurring jobs re-enqueue after each run
  trigger?: JobTrigger // defaults to 'demand': most enqueues are something happening
}

export async function enqueue(
  method: string,
  payload: Record<string, unknown> = {},
  opts: EnqueueOpts = {},
): Promise<string> {
  const name = jobName()
  await sql`
    insert into background_job ${sql({
      row_id: name,
      created_by: 'Administrator',
      updated_by: 'Administrator',
      method,
      payload: payload as unknown as string,
      job_status: 'queued',
      attempts: 0,
      max_attempts: opts.maxAttempts ?? 3,
      run_at: opts.runAt ?? new Date(),
      repeat_every: opts.repeatEvery ?? null,
      trigger: opts.trigger ?? 'demand',
    })}`
  return name
}

/** How one attempt ended. 'refused' is the job declining to act (#464). */
export type RunOutcome = 'success' | 'error' | 'refused'

interface ExecutionRecord {
  job: string
  method: string
  attempt: number
  outcome: RunOutcome
  startedAt: Date
  durationMs: number
  error?: string
  result?: string
}

// Every attempt is a Job Execution row, and the method's Scheduled Job row
// (when it has one) carries the latest: "when did this last run, did it work,
// how long did it take, what did it come to" answered from one row (#464).
async function logExecution(r: ExecutionRecord): Promise<void> {
  await sql`
    insert into job_execution ${sql({
      row_id: jobName(),
      created_by: 'Administrator',
      updated_by: 'Administrator',
      job: r.job,
      method: r.method,
      attempt: r.attempt,
      outcome: r.outcome,
      error: r.error ?? null,
      result: r.result ?? null,
      started_at: r.startedAt,
      duration_ms: r.durationMs,
    })}`
  await sql`
    update scheduled_job
    set last_run_at = ${r.startedAt}, last_outcome = ${r.outcome}, last_duration_ms = ${r.durationMs},
        problem_alert_queued = case
          when last_outcome is distinct from ${r.outcome} or ${r.outcome} = 'success' then false
          else problem_alert_queued end,
        last_result = ${r.outcome === 'error' ? (r.error ?? null) : (r.result ?? null)}, updated_at = now()
    where method = ${r.method}`
}

// The Scheduled Job row for a method, if an administrator has one. Absent
// means the method is not administered here (a one-off, or an app that
// enqueued its own recurrence) and the queue row's own repeat_every governs.
async function scheduledJob(method: string): Promise<{ cadence: string; enabled: boolean } | null> {
  const [row] = await sql`select ${scheduleColumns()} from scheduled_job s where s.method = ${method}`
  return row ? { cadence: String(row.cadence), enabled: isLive(row) } : null
}

// Loaded on first use: job-alerts reaches email.ts, which registers its own
// job against this module at import, so a static import would be a cycle.
// Never throws: the run is already recorded and its recurrence queued, and a
// mail problem must not turn a finished run back into a failed one.
async function alertProblem(p: import('./job-alerts').JobProblem): Promise<void> {
  try {
    const { alertJobProblem } = await import('./job-alerts')
    await alertJobProblem(p)
  } catch (err) {
    console.warn(JSON.stringify({ event: 'job_alert_failed', method: p.method, error: err instanceof Error ? err.message : String(err) }))
  }
}

// Claim and run a single due job. Returns true if one was processed.
export function runOneJob(): Promise<boolean> {
  return appOperation(runOneJobImpl)
}
async function runOneJobImpl(): Promise<boolean> {
  // Atomic claim: flip exactly one due queued job to running.
  const [claimed] = await sql`
    update background_job set job_status = 'running', updated_at = now()
    where row_id = (
      select row_id from background_job
      where job_status = 'queued' and (run_at is null or run_at <= now())
      order by run_at asc, created_at asc
      limit 1 for update skip locked
    )
    returning *`
  if (!claimed) return false

  const method = claimed.method as string
  const attempt = Number(claimed.attempts) + 1
  const maxAttempts = Number(claimed.max_attempts)
  const handler = registry.get(method)
  const payload = (claimed.payload as Record<string, unknown>) ?? {}

  // JOB-005: progress reports go to the job owner's realtime channel.
  //
  // `trigger` is nullable: a row without one that repeats is a recurrence
  // ('schedule'), never 'demand'. Getting this wrong silently ends the
  // recurrence under the trigger === 'schedule' gate below (#287).
  const trigger: JobTrigger =
    (claimed.trigger as JobTrigger | null) ?? (claimed.repeat_every != null ? 'schedule' : 'demand')
  let result: string | undefined
  let refused = false
  const ctx: JobContext = {
    setResult: (text) => {
      // A refusal's reason is the run's result; nothing after it replaces it.
      if (!refused) result = text
    },
    refuse: (reason) => {
      refused = true
      result = reason
    },
    setProgress: (percent, message) =>
      publishUserEvent(claimed.created_by as string, 'job_progress', {
        job: claimed.row_id,
        method,
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        message: message ?? null,
      }),
    job: { row_id: claimed.row_id as string, trigger },
  }

  const startedAt = new Date()
  const record = (outcome: RunOutcome, error?: string): ExecutionRecord => ({
    job: claimed.row_id as string,
    method,
    attempt,
    outcome,
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
    error,
    result,
  })

  try {
    if (!handler) throw new Error(`No job handler registered for "${method}"`)
    await handler(payload, ctx)
    await sql`
      update background_job set job_status = 'done', attempts = ${attempt}, error = null, updated_at = now()
      where row_id = ${claimed.row_id as string}`
    await logExecution(record(refused ? 'refused' : 'success'))

    // JOB-003: recurring jobs re-enqueue for the next interval. A Scheduled
    // Job row, when there is one, is the authority: its cadence (edited since
    // this row was queued, perhaps) sets the interval, and disabled means the
    // recurrence ends here. Without a row the queue entry's own repeat_every
    // governs, as it always did.
    //
    // An administered method's recurrence advances only when THIS run was
    // itself the scheduled occurrence. syncScheduledJobs already guarantees
    // exactly one live ('queued'/'running') entry per enabled row; a demand
    // or manual run (recordMiss waking the refresh worker between two
    // scheduled occurrences, or a person hitting "run now") must not queue a
    // second one alongside it — that leaves two future occurrences live at
    // once, one of them never reachable by the invariant syncScheduledJobs
    // otherwise enforces (found in review, 19-Sep-2026). Those triggers still
    // did the work; they just don't get to move the clock.
    const administered = await scheduledJob(method)
    if (administered) {
      if (trigger === 'schedule' && administered.enabled) {
        const every = cadenceSeconds(administered.cadence)
        await enqueue(method, payload, {
          maxAttempts,
          runAt: new Date(Date.now() + every * 1000),
          repeatEvery: every,
          trigger: 'schedule',
        })
      }
    } else if (claimed.repeat_every != null) {
      const every = Number(claimed.repeat_every)
      if (every > 0)
        await enqueue(method, payload, {
          maxAttempts,
          runAt: new Date(Date.now() + every * 1000),
          repeatEvery: every,
          trigger: 'schedule',
        })
    }
    if (administered && refused)
      await alertProblem({ job: claimed.row_id as string, method, outcome: 'refused', message: result ?? 'no reason given', attempts: attempt, at: startedAt })
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // JOB-002: retry until max_attempts, then land in failed. A final
    // failure lands there now.
    const nextStatus = err instanceof FinalJobFailure || attempt >= maxAttempts ? 'failed' : 'queued'
    await sql`
      update background_job
      set job_status = ${nextStatus}, attempts = ${attempt}, error = ${message}, updated_at = now()
      where row_id = ${claimed.row_id as string}`
    await logExecution(record('error', message))
    const administered = nextStatus === 'failed' ? await scheduledJob(method) : null
    // A recurrence must survive its own failure. Before Scheduled Job, a run
    // that exhausted its attempts ended the recurrence until the next restart
    // re-seeded it from a literal — a schedule that silently stopped. Now the
    // row is the schedule: if it is enabled, the next interval is queued
    // regardless of how this one ended. Same gate as the success path: only
    // the schedule's own occurrence advances the schedule, so a demand or
    // manual run that exhausts its attempts does not fork a second chain.
    if (nextStatus === 'failed' && trigger === 'schedule') {
      if (administered?.enabled) {
        const every = cadenceSeconds(administered.cadence)
        await enqueue(method, payload, {
          maxAttempts,
          runAt: new Date(Date.now() + every * 1000),
          repeatEvery: every,
          trigger: 'schedule',
        })
      }
    }
    // #464: a run that has failed for good tells the System Managers; an
    // attempt that will be retried does not.
    if (administered)
      await alertProblem({ job: claimed.row_id as string, method, outcome: 'failed', message, attempts: attempt, at: startedAt })
    return true
  }
}

// Make the queue agree with the Scheduled Job rows: every enabled row has
// exactly one live (queued or running) entry carrying its cadence, and a
// disabled row has none. Runs at boot (replacing the literal seeds that used
// to live in index.ts) and after every save of a Scheduled Job, so an edit in
// the Admin is in force before the page has finished reloading.
//
// A cadence change re-times the pending entry rather than replacing it:
// its next run moves to whichever is sooner, the time it already had or one
// new interval from now — shortening "daily" to "hourly" fires within the
// hour; lengthening never fires early. Idempotent: calling it twice stacks
// nothing (the duplicate-recurrence bug the old boot guards existed for).
export async function syncScheduledJobs(method?: string): Promise<void> {
  const rows = method
    ? await sql`select ${scheduleColumns()} from scheduled_job s where s.method = ${method}`
    : await sql`select ${scheduleColumns()} from scheduled_job s`
  for (const row of rows) {
    const name = String(row.method)
    if (!isLive(row)) {
      await sql`delete from background_job where method = ${name} and job_status = 'queued'`
      continue
    }
    const every = cadenceSeconds(String(row.cadence))
    const live = await sql`
      select row_id, job_status, repeat_every, run_at from background_job
      where method = ${name} and job_status in ('queued', 'running')
      order by run_at asc`
    if (!live.length) {
      await enqueue(name, {}, { repeatEvery: every, trigger: 'schedule' })
      continue
    }
    // One live entry is the invariant; anything beyond the first is a stacked
    // duplicate from an older seed path and is dropped.
    const [keep, ...extra] = live
    if (extra.length) {
      const ids = extra.filter((r) => r.job_status === 'queued').map((r) => String(r.row_id))
      if (ids.length) await sql`delete from background_job where row_id in ${sql(ids)}`
    }
    if (keep.job_status === 'queued' && Number(keep.repeat_every) !== every) {
      const soonest = new Date(Math.min(new Date(keep.run_at as string).getTime(), Date.now() + every * 1000))
      await sql`
        update background_job set repeat_every = ${every}, run_at = ${soonest}, updated_at = now()
        where row_id = ${String(keep.row_id)}`
    }
  }
}

// JOB-004: re-queue a failed job so the worker runs it again (fresh attempt
// counter, cleared error). Returns false if the job isn't failed / not found.
export async function retryJob(name: string): Promise<boolean> {
  const [row] = await sql`
    update background_job
    set job_status = 'queued', attempts = 0, error = null, run_at = now(), trigger = 'retry', updated_at = now()
    where row_id = ${name} and job_status = 'failed'
    returning row_id`
  return Boolean(row)
}

// Drain all currently-due jobs (bounded so a recurring job can't loop forever).
export async function drainJobs(limit = 1000): Promise<number> {
  let processed = 0
  while (processed < limit) {
    const did = await runOneJob()
    if (!did) break
    processed++
  }
  return processed
}

let timer: ReturnType<typeof setInterval> | null = null
export function startWorker(intervalMs = Number(readVariable('JOB_POLL_MS') ?? 500)): void {
  if (timer) return
  let ticking = false
  timer = setInterval(async () => {
    if (ticking) return
    ticking = true
    try {
      await runOneJob()
    } catch {
      // A worker crash must not kill the interval.
    } finally {
      ticking = false
    }
  }, intervalMs)
}

export function stopWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

// Job modules live in src/jobs/*.ts and register handlers at import.
let loaded = false
export async function loadJobs(): Promise<void> {
  if (loaded) return
  loaded = true
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'jobs')
  // The directory ships with the source (the server runs src/ through tsx).
  const files = readdirSync(dir).filter((f) => /\.(ts|js|mjs)$/.test(f))
  for (const file of files) await import(pathToFileURL(join(dir, file)).href)
}

/** #700: withdraw every handler an app registered (its app was disabled,
 *  upgraded or removed). Handlers someone else registered are left alone. */
export function unregisterAppJobs(owner: string): void {
  for (const [method, registrant] of owners)
    if (registrant === owner) {
      registry.delete(method)
      owners.delete(method)
    }
}
