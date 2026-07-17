import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { drainJobs, enqueue, loadJobs, runOneJob } from '../src/jobs'

// JOB-001: enqueue → worker processes → queue drains.
// JOB-002: retries until success; permanent failure lands in `failed`.

beforeAll(async () => {
  await loadJobs()
  await sql`delete from tab_background_job`
  await sql`delete from tab_job_execution`
  await sql.unsafe('drop table if exists job_demo_rows, job_flaky_counter')
})

afterAll(async () => {
  await sql`delete from tab_background_job`
  await sql`delete from tab_job_execution`
  await sql.unsafe('drop table if exists job_demo_rows, job_flaky_counter')
})

describe('JOB-001: enqueue + worker + drain', () => {
  it('processes an enqueued job that writes a row, then the queue drains', async () => {
    const id = await enqueue('demo_write_row', { note: 'hello' })
    // Queued initially.
    const [before] = await sql`select status from tab_background_job where name = ${id}`
    expect(before.status).toBe('queued')

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
  it('a job that throws twice then succeeds records 3 attempts', async () => {
    const id = await enqueue('demo_flaky', { key: 'k1', fail_until: 2 }, { maxAttempts: 5 })
    // Each drain runs the job once; a requeued (still-due) job is picked up
    // again in the same drain loop, so one drain runs all three attempts.
    await drainJobs()
    const [job] = await sql`select status, attempts from tab_background_job where name = ${id}`
    expect(job.status).toBe('done')
    expect(Number(job.attempts)).toBe(3)
    const execs = await sql`select attempt, outcome from tab_job_execution where job = ${id} order by attempt`
    expect(execs.map((e) => e.outcome)).toEqual(['error', 'error', 'success'])
  })

  it('a permanently failing job lands in failed with the error, after max attempts', async () => {
    const id = await enqueue('demo_always_fails', {}, { maxAttempts: 3 })
    await drainJobs()
    const [job] = await sql`select status, attempts, error from tab_background_job where name = ${id}`
    expect(job.status).toBe('failed')
    expect(Number(job.attempts)).toBe(3)
    expect(job.error).toContain('always fails')
    const execs = await sql`select outcome from tab_job_execution where job = ${id}`
    expect(execs).toHaveLength(3)
    expect(execs.every((e) => e.outcome === 'error')).toBe(true)
  })

  it('an unknown job method fails cleanly rather than hanging', async () => {
    const id = await enqueue('no_such_job', {}, { maxAttempts: 1 })
    await drainJobs()
    const [job] = await sql`select status, error from tab_background_job where name = ${id}`
    expect(job.status).toBe('failed')
    expect(job.error).toContain('No job handler')
  })
})
