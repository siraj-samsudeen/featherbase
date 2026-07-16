import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { drainJobs, enqueue, loadJobs, startWorker, stopWorker } from '../src/jobs'

// JOB-003: a recurring job re-enqueues itself and fires repeatedly, logging
// each execution. The production schedule is minutely; the test uses a short
// interval to exercise the same re-enqueue path in seconds.

beforeAll(async () => {
  await loadJobs()
  await sql`delete from tab_background_job where method = 'demo_heartbeat'`
  await sql`delete from tab_job_execution where method = 'demo_heartbeat'`
  await sql.unsafe('drop table if exists job_heartbeat')
})

afterAll(async () => {
  stopWorker()
  await sql`delete from tab_background_job where method = 'demo_heartbeat'`
  await sql`delete from tab_job_execution where method = 'demo_heartbeat'`
  await sql.unsafe('drop table if exists job_heartbeat')
})

describe('JOB-003: recurring jobs', () => {
  it('re-enqueues on its interval and fires at least twice, logging executions', async () => {
    // 1-second cadence; run for a few seconds via the real worker.
    await enqueue('demo_heartbeat', {}, { repeatEvery: 1 })

    startWorker(200)
    // Wait ~2.5s so the first run + at least one re-enqueued run both fire.
    await new Promise((r) => setTimeout(r, 2500))
    stopWorker()

    const beats = (await sql`select count(*)::int as c from job_heartbeat`)[0].c as number
    expect(beats).toBeGreaterThanOrEqual(2)

    const execs = (await sql`
      select count(*)::int as c from tab_job_execution
      where method = 'demo_heartbeat' and outcome = 'success'`)[0].c as number
    expect(execs).toBeGreaterThanOrEqual(2)

    // A fresh recurring job is always waiting (queue never permanently drains).
    const queued = (await sql`
      select count(*)::int as c from tab_background_job
      where method = 'demo_heartbeat' and status = 'queued'`)[0].c as number
    expect(queued).toBeGreaterThanOrEqual(1)
  }, 15_000)

  it('drainJobs runs one cycle without looping on the re-enqueued future job', async () => {
    // A recurring job scheduled in the future should not be picked up now.
    await sql`delete from tab_background_job where method = 'demo_heartbeat'`
    await enqueue('demo_heartbeat', {}, { repeatEvery: 3600 })
    const processed = await drainJobs()
    expect(processed).toBe(1) // ran once; its re-enqueue is 1h out, not due
  })
})
