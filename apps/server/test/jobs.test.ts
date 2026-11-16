import { describe, expect } from 'vitest'
import { makeJobDue, nudgeDueJobs } from './jobs-due'
import { test } from './pg-test'
import { sql } from '../src/db'
import { FinalJobFailure, drainJobs, enqueue, loadJobs, registerJob, runOneJob, startWorker, stopWorker } from '../src/jobs'
import { expectStatus } from './fixtures'

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

describe('a queued row written with no payload or trigger', () => {
  // The columns are nullable; enqueue always fills them, a direct write may not.
  test('runs with an empty payload, as a one-off on demand', async () => {
    await setup()
    const seen: unknown[] = []
    registerJob('job_bare_row', (payload, ctx) => { seen.push(payload, ctx.job.trigger) })
    await sql`insert into background_job ${sql({
      row_id: 'job-bare-row', created_by: 'Administrator', updated_by: 'Administrator',
      method: 'job_bare_row', job_status: 'queued', attempts: 0, max_attempts: 1, payload: null, trigger: null,
    })}`
    await drainJobs()
    expect(seen).toEqual([{}, 'demand'])
  })

  test('a row with no Scheduled Job that repeats every 0 seconds runs once', async () => {
    await setup()
    let runs = 0
    registerJob('job_zero_repeat', () => { runs++ })
    await sql`insert into background_job ${sql({
      row_id: 'job-zero-repeat', created_by: 'Administrator', updated_by: 'Administrator',
      method: 'job_zero_repeat', job_status: 'queued', attempts: 0, max_attempts: 1, payload: {}, repeat_every: 0, trigger: 'schedule',
    })}`
    await drainJobs()
    expect(runs).toBe(1)
    expect(await sql`select 1 from background_job where method = 'job_zero_repeat' and job_status = 'queued'`).toHaveLength(0)
  })
})

describe('Long work runs in the background', () => {
  test('stopping a repeatedly started worker leaves queued work for a later start', async () => {
    await setup()
    startWorker(10)
    startWorker(10)
    stopWorker()
    const id = await enqueue('ping_job', {})
    await nudgeDueJobs()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect((await sql`select job_status from background_job where row_id = ${id}`)[0].job_status).toBe('queued')
  })

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

describe('the worker with no interval given', () => {
  test('polls on its default interval', async () => {
    await setup()
    const id = await enqueue('ping_job', {})
    await nudgeDueJobs()
    startWorker()
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

  test('stopping a worker that is not running does nothing', () => {
    expect(() => stopWorker()).not.toThrow()
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

  test('a job that ends in a final failure is failed at once, without spending its other attempts (#334)', async () => {
    await setup()
    registerJob('test_final_failure', () => {
      throw new FinalJobFailure('refused for good')
    })
    const id = await enqueue('test_final_failure', {}, { maxAttempts: 3 })
    await nudgeDueJobs()
    await drainJobs()
    const [job] = await sql`select job_status, attempts, error from background_job where row_id = ${id}`
    expect(job).toMatchObject({ job_status: 'failed', error: 'refused for good' })
    expect(Number(job.attempts)).toBe(1)
    const execs = await sql`select outcome, error from job_execution where job = ${id}`
    expect(execs).toEqual([expect.objectContaining({ outcome: 'error', error: 'refused for good' })])
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

// A deploy switches on a new scheduled job while the previous deployment, whose
// code has no handler for it, is still polling the queue. That worker hands the
// run back instead of failing it, so the new deployment runs it.
describe('a scheduled job this server has no handler for yet', () => {
  const schedule = (method: string) =>
    sql`insert into scheduled_job (row_id, method, cadence, enabled, description, problem_alert_queued)
        values (${method}, ${method}, 'hourly', true, 'made up', false)`

  test('is handed back about a minute later, using up no attempt', async () => {
    await setup()
    await schedule('made_up_new_job')
    const id = await enqueue('made_up_new_job', {}, { trigger: 'schedule', repeatEvery: 3600 })
    await nudgeDueJobs()

    expect(await runOneJob()).toBe(true)

    const [job] = await sql`
      select job_status, attempts, error, handed_back_at is not null as handed_back,
             extract(epoch from run_at - clock_timestamp()) as wait from background_job where row_id = ${id}`
    expect(job).toMatchObject({ job_status: 'queued', attempts: 0, handed_back: true })
    expect(Number(job.wait)).toBeGreaterThan(50)
    expect(job.error).toBe('Waiting for a server that has a handler for "made_up_new_job"')
    expect(await sql`select 1 from job_execution where job = ${id}`).toEqual([])
  })

  test('runs once a server that has the handler takes it', async () => {
    await setup()
    await schedule('made_up_arriving_job')
    const id = await enqueue('made_up_arriving_job', {}, { trigger: 'schedule', repeatEvery: 3600 })
    await nudgeDueJobs()
    await runOneJob()
    registerJob('made_up_arriving_job', () => {})
    await makeJobDue(id)

    expect(await runOneJob()).toBe(true)

    const [job] = await sql`select job_status, attempts, error from background_job where row_id = ${id}`
    expect(job).toMatchObject({ job_status: 'done', attempts: 1, error: null })
  })

  test('fails as an unknown job once it has waited 30 minutes', async () => {
    await setup()
    await schedule('made_up_missing_job')
    const id = await enqueue('made_up_missing_job', {}, { trigger: 'schedule', repeatEvery: 3600, maxAttempts: 1 })
    await nudgeDueJobs()
    await sql`update background_job set handed_back_at = now() - interval '31 minutes' where row_id = ${id}`

    await runOneJob()

    const [job] = await sql`select job_status, error from background_job where row_id = ${id}`
    expect(job.job_status).toBe('failed')
    expect(job.error).toContain('No job handler')
  })

  test('a switched-off schedule does not hold its run back', async () => {
    await setup()
    await schedule('made_up_off_job')
    await sql`update scheduled_job set enabled = false where row_id = 'made_up_off_job'`
    const id = await enqueue('made_up_off_job', {}, { maxAttempts: 1 })
    await nudgeDueJobs()
    await runOneJob()
    const [job] = await sql`select job_status, error from background_job where row_id = ${id}`
    expect(job).toMatchObject({ job_status: 'failed' })
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
    await expectStatus(await outsider.fetch('/api/table/Background%20Job'), 403)
  })
})

describe('the worker', () => {
  test('does not start another tick while a job is still running', async () => {
    await setup()
    let running = 0
    let most = 0
    registerJob('slow_job', async () => {
      most = Math.max(most, ++running)
      await new Promise((r) => setTimeout(r, 120))
      running--
    })
    const id = await enqueue('slow_job', {})
    await makeJobDue(id)
    startWorker(10)
    try {
      await expect.poll(async () => (await sql`select job_status from background_job where row_id = ${id}`)[0].job_status, { timeout: 5000 }).toBe('done')
    } finally {
      stopWorker()
      // A tick already under way finishes inside this test, never after it.
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(most).toBe(1)
    expect(await sql`select attempt from job_execution where job = ${id}`).toEqual([{ attempt: 1 }])
  })
})
