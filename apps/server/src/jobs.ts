import { randomBytes } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { sql } from './db'

// JOB-001/002/003: durable job queue with an in-process worker.
//
// Jobs are named functions in a registry. enqueue() persists a Background
// Job row; the worker claims due jobs (queued + run_at<=now) one at a time,
// runs the handler with at-least-once semantics, retries up to max_attempts,
// logs every attempt as a Job Execution, and re-enqueues recurring jobs.

export type JobHandler = (payload: Record<string, unknown>) => unknown | Promise<unknown>

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
}

export async function enqueue(
  method: string,
  payload: Record<string, unknown> = {},
  opts: EnqueueOpts = {},
): Promise<string> {
  const name = jobName()
  await sql`
    insert into tab_background_job ${sql({
      name,
      owner: 'Administrator',
      modified_by: 'Administrator',
      method,
      payload: payload as unknown as string,
      status: 'queued',
      attempts: 0,
      max_attempts: opts.maxAttempts ?? 3,
      run_at: opts.runAt ?? new Date(),
      repeat_every: opts.repeatEvery ?? null,
    })}`
  return name
}

async function logExecution(
  job: string,
  method: string,
  attempt: number,
  outcome: 'success' | 'error',
  error?: string,
): Promise<void> {
  await sql`
    insert into tab_job_execution ${sql({
      name: jobName(),
      owner: 'Administrator',
      modified_by: 'Administrator',
      job,
      method,
      attempt,
      outcome,
      error: error ?? null,
    })}`
}

// Claim and run a single due job. Returns true if one was processed.
export async function runOneJob(): Promise<boolean> {
  // Atomic claim: flip exactly one due queued job to running.
  const [claimed] = await sql`
    update tab_background_job set status = 'running', modified = now()
    where name = (
      select name from tab_background_job
      where status = 'queued' and (run_at is null or run_at <= now())
      order by run_at asc, creation asc
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

  try {
    if (!handler) throw new Error(`No job handler registered for "${method}"`)
    await handler(payload)
    await sql`
      update tab_background_job set status = 'done', attempts = ${attempt}, error = null, modified = now()
      where name = ${claimed.name as string}`
    await logExecution(claimed.name as string, method, attempt, 'success')

    // JOB-003: recurring jobs re-enqueue for the next interval.
    const every = claimed.repeat_every == null ? null : Number(claimed.repeat_every)
    if (every && every > 0)
      await enqueue(method, payload, {
        maxAttempts,
        runAt: new Date(Date.now() + every * 1000),
        repeatEvery: every,
      })
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // JOB-002: retry until max_attempts, then land in failed.
    const nextStatus = attempt >= maxAttempts ? 'failed' : 'queued'
    await sql`
      update tab_background_job
      set status = ${nextStatus}, attempts = ${attempt}, error = ${message}, modified = now()
      where name = ${claimed.name as string}`
    await logExecution(claimed.name as string, method, attempt, 'error', message)
    return true
  }
}

// JOB-004: re-queue a failed job so the worker runs it again (fresh attempt
// counter, cleared error). Returns false if the job isn't failed / not found.
export async function retryJob(name: string): Promise<boolean> {
  const [row] = await sql`
    update tab_background_job
    set status = 'queued', attempts = 0, error = null, run_at = now(), modified = now()
    where name = ${name} and status = 'failed'
    returning name`
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
