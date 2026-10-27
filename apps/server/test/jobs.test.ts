import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, enqueue, loadJobs, runOneJob, startWorker, stopWorker } from '../src/jobs'

// JOB-001: enqueue → worker processes → queue drains.
// JOB-002: retries until success; permanent failure lands in `failed`.

// Handler registration is per-process (loadJobs is idempotent); all DB state
// (queue rows, scratch tables) lives in the sandbox transaction and rolls
// back, so clearing pre-existing committed rows inside the tx is enough.
async function setup() {
  await loadJobs()
  await sql`delete from background_job`
  await sql`delete from job_execution`
  await sql.unsafe('drop table if exists job_demo_rows, job_flaky_counter')
}

// Sandbox clock shim: inside the rolled-back test transaction now() is frozen
// at BEGIN, while enqueue() stamps run_at from the wall clock — so nothing
// ever counts as "due" for the claim query. Mark any job whose run_at has
// passed by the wall clock (clock_timestamp) as due by the transaction clock.
async function nudgeDueJobs() {
  await sql`
    update background_job set run_at = now()
    where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
}

describe('JOB-001: enqueue + worker + drain', () => {
  test('processes an enqueued job that writes a row, then the queue drains', async () => {
    await setup()
    const id = await enqueue('demo_write_row', { note: 'hello' })
    // Queued initially.
    const [before] = await sql`select job_status from background_job where row_id = ${id}`
    expect(before.job_status).toBe('queued')

    await nudgeDueJobs()
    const processed = await drainJobs()
    expect(processed).toBeGreaterThanOrEqual(1)

    // The side effect happened.
    const rows = await sql`select note from job_demo_rows`
    expect(rows.map((r) => r.note)).toContain('hello')

    // The job is done and the queue is drained (no more due jobs).
    const [after] = await sql`select job_status, attempts from background_job where row_id = ${id}`
    expect(after.job_status).toBe('done')
    expect(Number(after.attempts)).toBe(1)
    expect(await runOneJob()).toBe(false)

    // Execution logged.
    const execs = await sql`select outcome from job_execution where job = ${id}`
    expect(execs).toHaveLength(1)
    expect(execs[0].outcome).toBe('success')
  })
})

describe('Long work runs in the background', () => {
  test('the worker picks up a queued job on its own, without anyone draining the queue', async () => {
    await setup()
    const id = await enqueue('ping_job', {})
    await nudgeDueJobs()
    startWorker(20)
    try {
      const deadline = Date.now() + 5000
      let status = 'queued'
      while (status !== 'done' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50))
        status = String((await sql`select job_status from background_job where row_id = ${id}`)[0].job_status)
      }
      expect(status).toBe('done')
    } finally {
      stopWorker()
    }
  })
})

describe('JOB-002: retries and failure state', () => {
  test('a job that throws twice then succeeds records 3 attempts', async () => {
    await setup()
    const id = await enqueue('demo_flaky', { key: 'k1', fail_until: 2 }, { maxAttempts: 5 })
    // Each drain runs the job once; a requeued (still-due) job is picked up
    // again in the same drain loop, so one drain runs all three attempts.
    await nudgeDueJobs()
    await drainJobs()
    const [job] = await sql`select job_status, attempts from background_job where row_id = ${id}`
    expect(job.job_status).toBe('done')
    expect(Number(job.attempts)).toBe(3)
    const execs = await sql`select attempt, outcome from job_execution where job = ${id} order by attempt`
    expect(execs.map((e) => e.outcome)).toEqual(['error', 'error', 'success'])
  })

  test('a permanently failing job lands in failed with the error, after max attempts', async () => {
    await setup()
    const id = await enqueue('demo_always_fails', {}, { maxAttempts: 3 })
    await nudgeDueJobs()
    await drainJobs()
    const [job] = await sql`select job_status, attempts, error from background_job where row_id = ${id}`
    expect(job.job_status).toBe('failed')
    expect(Number(job.attempts)).toBe(3)
    expect(job.error).toContain('always fails')
    const execs = await sql`select outcome from job_execution where job = ${id}`
    expect(execs).toHaveLength(3)
    expect(execs.every((e) => e.outcome === 'error')).toBe(true)
  })

  test('an unknown job method fails cleanly rather than hanging', async () => {
    await setup()
    const id = await enqueue('no_such_job', {}, { maxAttempts: 1 })
    await nudgeDueJobs()
    await drainJobs()
    const [job] = await sql`select job_status, error from background_job where row_id = ${id}`
    expect(job.job_status).toBe('failed')
    expect(job.error).toContain('No job handler')
  })
})

describe('See every job\'s status in one place', () => {
  test('an admin\'s list of background jobs shows status, attempts and the error', async ({ admin, createUser }) => {
    await setup()
    const failed = await enqueue('demo_always_fails', {}, { maxAttempts: 2 })
    const done = await enqueue('ping_job', {})
    const waiting = await enqueue('ping_job', {}, { runAt: new Date(Date.now() + 3_600_000) })
    await nudgeDueJobs()
    await drainJobs()

    const list = await admin.get<{ data: { row_id: string; job_status: string; attempts: number; error: string | null }[] }>(
      `/api/table/Background%20Job?limit_page_length=50&fields=${encodeURIComponent(JSON.stringify(['row_id', 'job_status', 'attempts', 'error']))}`,
    )
    const byId = new Map(list.data.map((j) => [j.row_id, j]))
    expect(byId.get(failed)?.job_status).toBe('failed')
    expect(Number(byId.get(failed)?.attempts)).toBe(2)
    expect(byId.get(failed)?.error).toContain('always fails')
    expect(byId.get(done)?.job_status).toBe('done')
    expect(Number(byId.get(done)?.attempts)).toBe(1)
    expect(byId.get(done)?.error).toBeNull()
    expect(byId.get(waiting)?.job_status).toBe('queued')
    expect(Number(byId.get(waiting)?.attempts)).toBe(0)

    // Someone with no role cannot open the list.
    const outsider = await createUser({ roles: [] })
    expect((await outsider.fetch('/api/table/Background%20Job')).status).toBe(403)
  })
})
