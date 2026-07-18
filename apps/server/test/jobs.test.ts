import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, enqueue, loadJobs, runOneJob } from '../src/jobs'

// JOB-001: enqueue → worker processes → queue drains.
// JOB-002: retries until success; permanent failure lands in `failed`.

// Handler registration is per-process (loadJobs is idempotent); all DB state
// (queue rows, scratch tables) lives in the sandbox transaction and rolls
// back, so clearing pre-existing committed rows inside the tx is enough.
async function setup() {
  await loadJobs()
  await sql`delete from tab_background_job`
  await sql`delete from tab_job_execution`
  await sql.unsafe('drop table if exists job_demo_rows, job_flaky_counter')
}

// Sandbox clock shim: inside the rolled-back test transaction now() is frozen
// at BEGIN, while enqueue() stamps run_at from the wall clock — so nothing
// ever counts as "due" for the claim query. Mark any job whose run_at has
// passed by the wall clock (clock_timestamp) as due by the transaction clock.
async function nudgeDueJobs() {
  await sql`
    update tab_background_job set run_at = now()
    where status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
}

describe('JOB-001: enqueue + worker + drain', () => {
  test('processes an enqueued job that writes a row, then the queue drains', async () => {
    await setup()
    const id = await enqueue('demo_write_row', { note: 'hello' })
    // Queued initially.
    const [before] = await sql`select status from tab_background_job where name = ${id}`
    expect(before.status).toBe('queued')

    await nudgeDueJobs()
    const processed = await drainJobs()
    expect(processed).toBeGreaterThanOrEqual(1)

    // The side effect happened.
    const rows = await sql`select note from job_demo_rows`
    expect(rows.map((r) => r.note)).toContain('hello')

    // The job is done and the queue is drained (no more due jobs).
    const [after] = await sql`select status, attempts from tab_background_job where name = ${id}`
    expect(after.status).toBe('done')
    expect(Number(after.attempts)).toBe(1)
    expect(await runOneJob()).toBe(false)

    // Execution logged.
    const execs = await sql`select outcome from tab_job_execution where job = ${id}`
    expect(execs).toHaveLength(1)
    expect(execs[0].outcome).toBe('success')
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
    const [job] = await sql`select status, attempts from tab_background_job where name = ${id}`
    expect(job.status).toBe('done')
    expect(Number(job.attempts)).toBe(3)
    const execs = await sql`select attempt, outcome from tab_job_execution where job = ${id} order by attempt`
    expect(execs.map((e) => e.outcome)).toEqual(['error', 'error', 'success'])
  })

  test('a permanently failing job lands in failed with the error, after max attempts', async () => {
    await setup()
    const id = await enqueue('demo_always_fails', {}, { maxAttempts: 3 })
    await nudgeDueJobs()
    await drainJobs()
    const [job] = await sql`select status, attempts, error from tab_background_job where name = ${id}`
    expect(job.status).toBe('failed')
    expect(Number(job.attempts)).toBe(3)
    expect(job.error).toContain('always fails')
    const execs = await sql`select outcome from tab_job_execution where job = ${id}`
    expect(execs).toHaveLength(3)
    expect(execs.every((e) => e.outcome === 'error')).toBe(true)
  })

  test('an unknown job method fails cleanly rather than hanging', async () => {
    await setup()
    const id = await enqueue('no_such_job', {}, { maxAttempts: 1 })
    await nudgeDueJobs()
    await drainJobs()
    const [job] = await sql`select status, error from tab_background_job where name = ${id}`
    expect(job.status).toBe('failed')
    expect(job.error).toContain('No job handler')
  })
})
