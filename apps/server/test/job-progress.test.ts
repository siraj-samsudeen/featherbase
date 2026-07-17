import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, enqueue, loadJobs, registerJob } from '../src/jobs'
import { onEvent } from '../src/realtime'

// JOB-005: a running job reports progress to its owner's realtime channel via
// the JobContext.setProgress callback.

// Sandbox clock shim: inside the rolled-back test transaction now() is frozen
// at BEGIN, while enqueue() stamps run_at from the wall clock — so nothing
// ever counts as "due" for the claim query. Mark any job whose run_at has
// passed by the wall clock (clock_timestamp) as due by the transaction clock.
async function nudgeDueJobs() {
  await sql`
    update tab_background_job set run_at = now()
    where status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
}

describe('JOB-005: job progress reporting', () => {
  test('delivers setProgress calls as job_progress events on the owner channel', async () => {
    await loadJobs()
    const events: { channel: string; event: string; payload: { job?: string; percent?: number; message?: string } }[] = []
    // The realtime listener is process-global — always detach it in `finally`.
    const off = onEvent((e) => events.push(e as never))
    try {
      // The job registry is process-global too and has no unregister API; the
      // test-only method name is unique, so the leaked handler is inert.
      registerJob('progress_probe', async (_payload, ctx) => {
        ctx.setProgress(0, 'start')
        ctx.setProgress(50, 'half')
        ctx.setProgress(100, 'done')
      })
      const name = await enqueue('progress_probe', {})
      await nudgeDueJobs()
      await drainJobs()

      // Filter to THIS job's progress events.
      const progress = events.filter((e) => e.event === 'job_progress' && e.payload?.job === name)
      expect(progress.length).toBe(3)
      expect(progress.every((e) => e.channel === 'user:Administrator')).toBe(true)
      expect(progress.map((e) => e.payload.percent)).toEqual([0, 50, 100])
      expect(progress[2].payload.message).toBe('done')
    } finally {
      off()
    }
  })

  test('clamps and rounds reported percentages', async () => {
    await loadJobs()
    const events: { event: string; payload: { job?: string; percent?: number } }[] = []
    const off = onEvent((e) => events.push(e as never))
    try {
      registerJob('progress_clamp', async (_p, ctx) => {
        ctx.setProgress(-20)
        ctx.setProgress(133.7)
      })
      const name = await enqueue('progress_clamp', {})
      await nudgeDueJobs()
      await drainJobs()
      const percents = events.filter((e) => e.event === 'job_progress' && e.payload?.job === name).map((e) => e.payload.percent)
      expect(percents).toEqual([0, 100])
    } finally {
      off()
    }
  })
})
