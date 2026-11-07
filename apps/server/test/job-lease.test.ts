import { afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { ABANDONED_MESSAGE, drainJobs, enqueue, jobLease, loadJobs, registerJob, runOneJob } from '../src/jobs'

// #978: a job left `running` by a server that stopped mid-run is recovered
// once its lease runs out; a job whose worker is alive keeps its lease fresh.
//
// Sandbox note: now() is frozen at the test transaction's BEGIN, so leases
// are stamped and compared on clock_timestamp(). A stopped server is a
// running row whose lease is already in the past.

const METHOD = 'lease_probe'
const saved = { ...jobLease }
afterEach(() => Object.assign(jobLease, saved))

async function setup() {
  await loadJobs()
  await sql`delete from background_job`
  await sql`delete from job_execution`
  await sql`delete from scheduled_job where method = ${METHOD}`
  registerJob(METHOD, async () => {})
}

/** A row a stopped server was running: claimed, attempts unchanged, lease gone. */
async function abandoned(opts: { attempts?: number; maxAttempts?: number; trigger?: 'schedule' | 'demand'; lease?: 'expired' | 'none' | 'fresh'; claimedAgo?: string } = {}) {
  const id = await enqueue(METHOD, {}, {
    maxAttempts: opts.maxAttempts ?? 3,
    trigger: opts.trigger ?? 'demand',
    repeatEvery: opts.trigger === 'schedule' ? 3600 : undefined,
  })
  const lease = opts.lease ?? 'expired'
  await sql`
    update background_job set job_status = 'running', attempts = ${opts.attempts ?? 0},
      run_at = now(),
      updated_at = clock_timestamp() - ${opts.claimedAgo ?? '10 minutes'}::interval,
      lease_expires_at = case ${lease}
        when 'expired' then clock_timestamp() - interval '1 minute'
        when 'fresh' then clock_timestamp() + interval '5 minutes'
        else null end
    where row_id = ${id}`
  return id
}

async function job(id: string) {
  const [row] = await sql`select job_status, attempts, error, lease_expires_at from background_job where row_id = ${id}`
  return row
}

describe('A job left running by a stopped server is picked up again', () => {
  test('an expired lease counts as a failed attempt and the job runs again', async () => {
    await setup()
    let ran = 0
    registerJob(METHOD, async () => { ran++ })
    const id = await abandoned()

    await drainJobs()

    const row = await job(id)
    expect(row.job_status).toBe('done')
    expect(Number(row.attempts)).toBe(2)
    expect(ran).toBe(1)
    const execs = await sql`select attempt, outcome, error from job_execution where job = ${id} order by attempt`
    expect(execs.map((e) => [Number(e.attempt), e.outcome, e.error])).toEqual([
      [1, 'error', ABANDONED_MESSAGE],
      [2, 'success', null],
    ])
  })

  test('a job whose worker is still running is left alone', async () => {
    await setup()
    const id = await abandoned({ lease: 'fresh' })
    expect(await runOneJob()).toBe(false)
    expect((await job(id)).job_status).toBe('running')
  })

  test('a job that brought its server down on its last attempt fails for good', async () => {
    await setup()
    const id = await abandoned({ attempts: 2, maxAttempts: 3 })
    expect(await runOneJob()).toBe(true)
    const row = await job(id)
    expect(row.job_status).toBe('failed')
    expect(Number(row.attempts)).toBe(3)
    expect(row.error).toBe(ABANDONED_MESSAGE)
    expect(row.lease_expires_at).toBeNull()
  })

  test('a scheduled job abandoned on its last attempt still queues its next run and alerts', async () => {
    await setup()
    await sql`insert into scheduled_job ${sql({ row_id: METHOD, method: METHOD, cadence: 'hourly', enabled: true })}`
    const id = await abandoned({ attempts: 2, maxAttempts: 3, trigger: 'schedule' })

    expect(await runOneJob()).toBe(true)

    expect((await job(id)).job_status).toBe('failed')
    const next = await sql`select repeat_every, trigger from background_job where method = ${METHOD} and job_status = 'queued'`
    expect(next.map((r) => [Number(r.repeat_every), r.trigger])).toEqual([[3600, 'schedule']])
    const [schedule] = await sql`select last_outcome, last_result from scheduled_job where method = ${METHOD}`
    expect(schedule).toMatchObject({ last_outcome: 'error', last_result: ABANDONED_MESSAGE })
  })

  test('a row stuck from before leases is recovered an hour after it was claimed, not sooner', async () => {
    await setup()
    const recent = await abandoned({ lease: 'none', claimedAgo: '10 minutes' })
    const old = await abandoned({ lease: 'none', claimedAgo: '2 hours' })
    await drainJobs()
    expect((await job(recent)).job_status).toBe('running')
    expect((await job(old)).job_status).toBe('done')
  })

  test('a running job renews its lease while it works, and gives it up when done', async () => {
    await setup()
    Object.assign(jobLease, { leaseMs: 60_000, heartbeatMs: 20 })
    const seen: number[] = []
    let id = ''
    registerJob(METHOD, async () => {
      for (let i = 0; i < 3; i++) {
        const [row] = await sql`select lease_expires_at from background_job where row_id = ${id}`
        seen.push(new Date(row.lease_expires_at as string).getTime())
        await new Promise((r) => setTimeout(r, 60))
      }
    })
    id = await enqueue(METHOD, {})
    await sql`update background_job set run_at = now() where row_id = ${id}`

    expect(await runOneJob()).toBe(true)

    expect(seen[0]).toBeGreaterThan(Date.now() - 1000)
    expect(seen[2]).toBeGreaterThan(seen[0])
    const row = await job(id)
    expect(row.job_status).toBe('done')
    expect(row.lease_expires_at).toBeNull()
  })

  test('a renewal that fails does not stop the run; the next beat tries again', async () => {
    await setup()
    Object.assign(jobLease, { heartbeatMs: 20 })
    registerJob(METHOD, async () => {
      // An interval Postgres refuses: every renewal during this wait fails.
      jobLease.leaseMs = Number.NaN
      await new Promise((r) => setTimeout(r, 70))
      jobLease.leaseMs = saved.leaseMs
    })
    const id = await enqueue(METHOD, {})
    await sql`update background_job set run_at = now() where row_id = ${id}`
    expect(await runOneJob()).toBe(true)
    expect((await job(id)).job_status).toBe('done')
  })

  test('a failed attempt gives up its lease too', async () => {
    await setup()
    registerJob(METHOD, async () => { throw new Error('boom') })
    const id = await enqueue(METHOD, {})
    await sql`update background_job set run_at = now() where row_id = ${id}`
    expect(await runOneJob()).toBe(true)
    const row = await job(id)
    expect(row.job_status).toBe('queued')
    expect(row.lease_expires_at).toBeNull()
  })
})
