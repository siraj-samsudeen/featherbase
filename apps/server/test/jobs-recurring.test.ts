import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, enqueue, loadJobs, startWorker, stopWorker } from '../src/jobs'

// JOB-003: a recurring job re-enqueues itself and fires repeatedly, logging
// each execution. The production schedule is minutely; the test uses a short
// interval to exercise the same re-enqueue path in seconds.

async function setup() {
  await loadJobs()
  await sql`delete from tab_background_job where method = 'demo_heartbeat'`
  await sql`delete from tab_job_execution where method = 'demo_heartbeat'`
  await sql.unsafe('drop table if exists job_heartbeat')
}

// Sandbox clock shim: inside the rolled-back test transaction now() is frozen
// at BEGIN, while enqueue() stamps run_at from the wall clock — so nothing
// ever counts as "due" for the claim query. Mark any job whose run_at has
// passed by the wall clock (clock_timestamp) as due by the transaction clock.
// Interval semantics are preserved: a job becomes claimable only once its
// real run_at has passed.
async function nudgeDueJobs() {
  await sql`
    update tab_background_job set run_at = now()
    where status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
}

describe('JOB-003: recurring jobs', () => {
  test(
    're-enqueues on its interval and fires at least twice, logging executions',
    async () => {
      await setup()
      // 1-second cadence; run for a few seconds via the real worker. The
      // worker is process-global state — always stop it in `finally`.
      await enqueue('demo_heartbeat', {}, { repeatEvery: 1 })

      startWorker(200)
      try {
        // Wait ~2.5s so the first run + at least one re-enqueued run both
        // fire, nudging wall-clock-due jobs onto the frozen transaction clock.
        const until = Date.now() + 2500
        while (Date.now() < until) {
          await nudgeDueJobs()
          await new Promise((r) => setTimeout(r, 100))
        }
      } finally {
        stopWorker()
      }

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
    },
    15_000,
  )

  test('drainJobs runs one cycle without looping on the re-enqueued future job', async () => {
    await setup()
    // A recurring job scheduled in the future should not be picked up now.
    await enqueue('demo_heartbeat', {}, { repeatEvery: 3600 })
    await nudgeDueJobs()
    const processed = await drainJobs()
    expect(processed).toBe(1) // ran once; its re-enqueue is 1h out, not due
  })
})
