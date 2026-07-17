import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { drainJobs, enqueue, loadJobs, registerJob } from '../src/jobs'
import { onEvent } from '../src/realtime'

// JOB-005: a running job reports progress to its owner's realtime channel via
// the JobContext.setProgress callback.

beforeAll(async () => {
  await loadJobs()
})

afterAll(async () => {
  await sql`delete from tab_background_job where method in ('progress_probe', 'demo_progress')`
  await sql.end()
})

describe('JOB-005: job progress reporting', () => {
  it('delivers setProgress calls as job_progress events on the owner channel', async () => {
    const events: { channel: string; event: string; payload: { job?: string; percent?: number; message?: string } }[] = []
    const off = onEvent((e) => events.push(e as never))

    registerJob('progress_probe', async (_payload, ctx) => {
      ctx.setProgress(0, 'start')
      ctx.setProgress(50, 'half')
      ctx.setProgress(100, 'done')
    })
    const name = await enqueue('progress_probe', {})
    await drainJobs() // may also run leftover jobs from other files — fine
    off()

    // Filter to THIS job's progress events (the shared queue may hold others).
    const progress = events.filter((e) => e.event === 'job_progress' && e.payload?.job === name)
    expect(progress.length).toBe(3)
    expect(progress.every((e) => e.channel === 'user:Administrator')).toBe(true)
    expect(progress.map((e) => e.payload.percent)).toEqual([0, 50, 100])
    expect(progress[2].payload.message).toBe('done')
  })

  it('clamps and rounds reported percentages', async () => {
    const events: { event: string; payload: { job?: string; percent?: number } }[] = []
    const off = onEvent((e) => events.push(e as never))
    registerJob('progress_clamp', async (_p, ctx) => {
      ctx.setProgress(-20)
      ctx.setProgress(133.7)
    })
    const name = await enqueue('progress_clamp', {})
    await drainJobs()
    off()
    const percents = events.filter((e) => e.event === 'job_progress' && e.payload?.job === name).map((e) => e.payload.percent)
    expect(percents).toEqual([0, 100])
    await sql`delete from tab_background_job where method = 'progress_clamp'`
  })
})
