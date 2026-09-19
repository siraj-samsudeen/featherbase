import { randomBytes } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { sql } from './db'
import { publishUserEvent } from './realtime'

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
  /** The queue row being run, and why it exists. */
  job: { row_id: string; trigger: JobTrigger }
}
export type JobHandler = (
  payload: Record<string, unknown>,
  ctx: JobContext,
) => unknown | Promise<unknown>

const registry = new Map<string, JobHandler>()

export function registerJob(method: string, handler: JobHandler): void {
  registry.set(method, handler)
}

function jobName(): string {
  return randomBytes(6).toString('hex')
}

export interface EnqueueOpts {
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

interface ExecutionRecord {
  job: string
  method: string
  attempt: number
  outcome: 'success' | 'error'
  startedAt: Date
  durationMs: number
  error?: string
}

// Every attempt is a Job Execution row, and the method's Scheduled Job row
// (when it has one) carries the latest: "when did this last run, did it work,
// how long did it take" answered from the list view without a query.
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
      started_at: r.startedAt,
      duration_ms: r.durationMs,
    })}`
  await sql`
    update scheduled_job
    set last_run_at = ${r.startedAt}, last_outcome = ${r.outcome}, last_duration_ms = ${r.durationMs},
        updated_at = now()
    where method = ${r.method}`
}

// The Scheduled Job row for a method, if an administrator has one. Absent
// means the method is not administered here (a one-off, or an app that
// enqueued its own recurrence) and the queue row's own repeat_every governs.
async function scheduledJob(method: string): Promise<{ cadence: string; enabled: boolean } | null> {
  const [row] = await sql`select cadence, enabled from scheduled_job where method = ${method}`
  return row ? { cadence: String(row.cadence), enabled: Boolean(row.enabled) } : null
}

// Claim and run a single due job. Returns true if one was processed.
export async function runOneJob(): Promise<boolean> {
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
  // Int columns come back as strings (bigint) — coerce before arithmetic.
  const attempt = Number(claimed.attempts) + 1
  const maxAttempts = Number(claimed.max_attempts)
  const handler = registry.get(method)
  const payload = (claimed.payload as Record<string, unknown>) ?? {}

  // JOB-005: progress reports go to the job owner's realtime channel.
  const trigger = (claimed.trigger as JobTrigger | null) ?? 'demand'
  const ctx: JobContext = {
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
  const record = (outcome: 'success' | 'error', error?: string): ExecutionRecord => ({
    job: claimed.row_id as string,
    method,
    attempt,
    outcome,
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
    error,
  })

  try {
    if (!handler) throw new Error(`No job handler registered for "${method}"`)
    await handler(payload, ctx)
    await sql`
      update background_job set job_status = 'done', attempts = ${attempt}, error = null, updated_at = now()
      where row_id = ${claimed.row_id as string}`
    await logExecution(record('success'))

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
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // JOB-002: retry until max_attempts, then land in failed.
    const nextStatus = attempt >= maxAttempts ? 'failed' : 'queued'
    await sql`
      update background_job
      set job_status = ${nextStatus}, attempts = ${attempt}, error = ${message}, updated_at = now()
      where row_id = ${claimed.row_id as string}`
    await logExecution(record('error', message))
    // A recurrence must survive its own failure. Before Scheduled Job, a run
    // that exhausted its attempts ended the recurrence until the next restart
    // re-seeded it from a literal — a schedule that silently stopped. Now the
    // row is the schedule: if it is enabled, the next interval is queued
    // regardless of how this one ended. Same gate as the success path: only
    // the schedule's own occurrence advances the schedule, so a demand or
    // manual run that exhausts its attempts does not fork a second chain.
    if (nextStatus === 'failed' && trigger === 'schedule') {
      const administered = await scheduledJob(method)
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
    ? await sql`select method, cadence, enabled from scheduled_job where method = ${method}`
    : await sql`select method, cadence, enabled from scheduled_job`
  for (const row of rows) {
    const name = String(row.method)
    if (!row.enabled) {
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
export function startWorker(intervalMs = Number(process.env.JOB_POLL_MS ?? 500)): void {
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
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => /\.(ts|js|mjs)$/.test(f))
  } catch {
    return
  }
  for (const file of files) await import(pathToFileURL(join(dir, file)).href)
}
