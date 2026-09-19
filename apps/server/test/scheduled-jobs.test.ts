import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import {
  CADENCE_SECONDS,
  drainJobs,
  enqueue,
  loadJobs,
  registerJob,
  syncScheduledJobs,
} from '../src/jobs'

// Recurring jobs are Scheduled Job rows (migration 0086). The queue is derived
// from the rows — at boot and after every save — and the re-enqueue after a
// run reads the row, so an administrator's edit is in force on the next run.
//
// Sandbox note: now() is frozen at the test transaction's BEGIN while the
// worker stamps run_at from the wall clock, so a "due now" entry is nudged
// onto the transaction clock before draining (the jobs.test.ts shim).

const METHOD = 'scheduled_probe'

async function setup() {
  await loadJobs()
  await sql`delete from background_job`
  await sql`delete from job_execution`
  await sql`delete from scheduled_job where method = ${METHOD}`
}

async function nudgeDueJobs() {
  await sql`
    update background_job set run_at = now()
    where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
}

async function liveEntries(method: string) {
  return sql`
    select row_id, job_status, repeat_every, run_at, trigger from background_job
    where method = ${method} and job_status in ('queued', 'running') order by run_at`
}

describe('Scheduled Job: the queue is derived from the rows', () => {
  test('the three platform recurrences are rows, and a boot sync queues each exactly once', async () => {
    await setup()
    const rows = await sql`select method, cadence, enabled from scheduled_job order by method`
    const seeded = Object.fromEntries(rows.map((r) => [String(r.method), String(r.cadence)]))
    expect(seeded).toMatchObject({
      auto_email_reports: 'daily',
      check_sla: 'every minute',
      refresh_datasets: 'every 4 hours',
    })

    await syncScheduledJobs()
    await syncScheduledJobs() // idempotent: a restart stacks nothing
    for (const r of rows) {
      const live = await liveEntries(String(r.method))
      expect(live, String(r.method)).toHaveLength(1)
      expect(Number(live[0].repeat_every)).toBe(CADENCE_SECONDS[String(r.cadence)])
      expect(live[0].trigger).toBe('schedule')
    }
  })

  test('saving a row through the API re-times its queue entry; disabling withdraws it', async ({ admin }) => {
    await setup()
    registerJob(METHOD, async () => {})
    const created = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', {
      table: 'Scheduled Job',
      row: { method: METHOD, cadence: 'daily', enabled: true },
    })
    // The method is the identity (id_pattern field:method).
    expect(created.row_id).toBe(METHOD)
    let live = await liveEntries(METHOD)
    expect(live).toHaveLength(1)
    expect(Number(live[0].repeat_every)).toBe(CADENCE_SECONDS.daily)
    const dailyRunAt = new Date(live[0].run_at as string).getTime()

    // Shorten to hourly: the same entry, now hourly, and never later than it was.
    const shortened = await admin.post<{ updated_at: string }>('/api/save_row', {
      table: 'Scheduled Job',
      row: { row_id: METHOD, method: METHOD, cadence: 'hourly', enabled: true, updated_at: created.updated_at },
    })
    live = await liveEntries(METHOD)
    expect(live).toHaveLength(1)
    expect(Number(live[0].repeat_every)).toBe(CADENCE_SECONDS.hourly)
    expect(new Date(live[0].run_at as string).getTime()).toBeLessThanOrEqual(dailyRunAt)

    // Disable: nothing pending. Re-enable: one entry again.
    const disabled = await admin.post<{ updated_at: string }>('/api/save_row', {
      table: 'Scheduled Job',
      row: { row_id: METHOD, method: METHOD, cadence: 'hourly', enabled: false, updated_at: shortened.updated_at },
    })
    expect(await liveEntries(METHOD)).toHaveLength(0)
    await admin.post('/api/save_row', {
      table: 'Scheduled Job',
      row: { row_id: METHOD, method: METHOD, cadence: 'hourly', enabled: true, updated_at: disabled.updated_at },
    })
    expect(await liveEntries(METHOD)).toHaveLength(1)
  })

  test('an unknown cadence is refused field-wise — seconds are never typed by hand', async ({ admin }) => {
    await setup()
    await expect(
      admin.post('/api/save_row', {
        table: 'Scheduled Job',
        row: { method: METHOD, cadence: 'every 7 seconds', enabled: true },
      }),
    ).rejects.toMatchObject({ status: 417, type: 'ValidationError' })
    expect(await liveEntries(METHOD)).toHaveLength(0)
  })

  test('after a run, the next interval follows the row, not the stale entry it was queued with', async () => {
    await setup()
    registerJob(METHOD, async () => {})
    await sql`insert into scheduled_job ${sql({
      row_id: METHOD, created_by: 'Administrator', updated_by: 'Administrator',
      method: METHOD, cadence: 'daily', enabled: true,
    })}`
    await syncScheduledJobs(METHOD)
    // The administrator edits the row directly (as a migration or a bulk
    // update might) without a sync: the queued entry still says daily.
    await sql`update scheduled_job set cadence = 'hourly' where method = ${METHOD}`

    await nudgeDueJobs()
    expect(await drainJobs()).toBe(1)

    const live = await liveEntries(METHOD)
    expect(live).toHaveLength(1)
    expect(Number(live[0].repeat_every)).toBe(CADENCE_SECONDS.hourly)
    expect(live[0].trigger).toBe('schedule')
  })

  // Codex review, 19-Sep-2026: migration 0086 added `trigger` with no
  // backfill, so a row queued before it has trigger NULL in Postgres — and
  // syncScheduledJobs() adopts an existing live entry rather than replacing
  // it, so a legacy row can still be sitting in the queue with trigger NULL
  // on a deployment that has run the migration for days. The trigger ===
  // 'schedule' gate (added earlier in this same PR) must not read that NULL
  // as 'demand', or the recurrence silently ends the first time that row runs.
  test('a legacy row queued before the trigger column existed (trigger NULL) still advances its own recurrence', async () => {
    await setup()
    registerJob(METHOD, async () => {})
    await sql`insert into scheduled_job ${sql({
      row_id: METHOD, created_by: 'Administrator', updated_by: 'Administrator',
      method: METHOD, cadence: 'hourly', enabled: true,
    })}`
    // Simulate the pre-0086 row directly, the way an ALTER TABLE ADD COLUMN
    // with no backfill would leave it: repeat_every set (it was recurring),
    // trigger NULL (the column did not exist yet).
    await sql`
      insert into background_job ${sql({
        row_id: 'legacy-row', created_by: 'Administrator', updated_by: 'Administrator',
        method: METHOD, payload: {}, job_status: 'queued', attempts: 0, max_attempts: 3,
        run_at: new Date(), repeat_every: CADENCE_SECONDS.hourly,
      })}`
    await sql`update background_job set trigger = null where row_id = 'legacy-row'`

    await nudgeDueJobs()
    expect(await drainJobs()).toBe(1)

    const live = await liveEntries(METHOD)
    expect(live).toHaveLength(1) // the recurrence continued, not just ran once and stopped
    expect(live[0].trigger).toBe('schedule') // and is healthy going forward
  })

  test('a disabled row ends the recurrence after the run in flight', async () => {
    await setup()
    registerJob(METHOD, async () => {})
    await sql`insert into scheduled_job ${sql({
      row_id: METHOD, created_by: 'Administrator', updated_by: 'Administrator',
      method: METHOD, cadence: 'hourly', enabled: true,
    })}`
    await syncScheduledJobs(METHOD)
    await sql`update scheduled_job set enabled = false where method = ${METHOD}`
    await nudgeDueJobs()
    expect(await drainJobs()).toBe(1)
    expect(await liveEntries(METHOD)).toHaveLength(0)
  })

  test('a schedule survives its own failure: attempts exhausted still queues the next interval', async () => {
    await setup()
    registerJob(METHOD, async () => {
      throw new Error('upstream down')
    })
    await sql`insert into scheduled_job ${sql({
      row_id: METHOD, created_by: 'Administrator', updated_by: 'Administrator',
      method: METHOD, cadence: 'hourly', enabled: true,
    })}`
    await syncScheduledJobs(METHOD)
    await sql`update background_job set max_attempts = 1 where method = ${METHOD}`
    await nudgeDueJobs()
    expect(await drainJobs()).toBe(1)

    const [failed] = await sql`select 1 from background_job where method = ${METHOD} and job_status = 'failed'`
    expect(failed).toBeTruthy()
    const live = await liveEntries(METHOD)
    expect(live).toHaveLength(1)
    expect(new Date(live[0].run_at as string).getTime()).toBeGreaterThan(Date.now())

    const [row] = await sql`select last_outcome from scheduled_job where method = ${METHOD}`
    expect(row.last_outcome).toBe('error')
  })

  // Review, 19-Sep-2026: every completed run of an administered method
  // re-enqueued the schedule's next occurrence, whatever triggered it — so a
  // demand run (recordMiss waking the refresh worker) left the ORIGINAL
  // future occurrence live and added a second one alongside it.
  test('a demand run of an administered method does not fork a second recurrence chain', async () => {
    await setup()
    registerJob(METHOD, async () => {})
    await sql`insert into scheduled_job ${sql({
      row_id: METHOD, created_by: 'Administrator', updated_by: 'Administrator',
      method: METHOD, cadence: 'hourly', enabled: true,
    })}`
    await syncScheduledJobs(METHOD)
    // The very first occurrence a fresh sync queues runs immediately; let it
    // complete so the schedule's NEXT occurrence is genuinely in the future.
    await nudgeDueJobs()
    expect(await drainJobs()).toBe(1)
    const before = await liveEntries(METHOD)
    expect(before).toHaveLength(1)
    expect(before[0].trigger).toBe('schedule')
    const scheduledRowId = before[0].row_id

    // A reader's miss (or a person clicking "run now") wakes the worker
    // between two scheduled occurrences; the future occurrence above is not
    // due yet, so only the demand job runs.
    await enqueue(METHOD, {}, { trigger: 'demand' })
    await nudgeDueJobs()
    expect(await drainJobs()).toBe(1)

    const after = await liveEntries(METHOD)
    expect(after).toHaveLength(1) // still one, not two
    expect(after[0].row_id).toBe(scheduledRowId) // the original occurrence, untouched
    expect(after[0].trigger).toBe('schedule')
  })

  test('deleting the row withdraws the pending entry', async ({ admin }) => {
    await setup()
    registerJob(METHOD, async () => {})
    await admin.post('/api/save_row', {
      table: 'Scheduled Job',
      row: { method: METHOD, cadence: 'hourly', enabled: true },
    })
    expect(await liveEntries(METHOD)).toHaveLength(1)
    const res = await admin.fetch(`/api/table/${encodeURIComponent('Scheduled Job')}/${METHOD}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await liveEntries(METHOD)).toHaveLength(0)
  })
})

describe('Job observability: how long, and why', () => {
  test('every execution records when it started and how long it took; the row carries the latest', async () => {
    await setup()
    registerJob(METHOD, async () => {
      await new Promise((r) => setTimeout(r, 25))
    })
    await sql`insert into scheduled_job ${sql({
      row_id: METHOD, created_by: 'Administrator', updated_by: 'Administrator',
      method: METHOD, cadence: 'hourly', enabled: true,
    })}`
    await syncScheduledJobs(METHOD)
    await nudgeDueJobs()
    expect(await drainJobs()).toBe(1)

    const [exec] = await sql`
      select started_at, duration_ms, outcome from job_execution where method = ${METHOD}`
    expect(exec.outcome).toBe('success')
    expect(exec.started_at).toBeTruthy()
    expect(Number(exec.duration_ms)).toBeGreaterThanOrEqual(20)

    const [row] = await sql`
      select last_run_at, last_outcome, last_duration_ms from scheduled_job where method = ${METHOD}`
    expect(row.last_outcome).toBe('success')
    expect(new Date(row.last_run_at as string).toISOString()).toBe(new Date(exec.started_at as string).toISOString())
    expect(Number(row.last_duration_ms)).toBe(Number(exec.duration_ms))
  })

  test('a queue entry says why it exists: demand by default, manual from the API, retry after a failure', async ({ admin }) => {
    await setup()
    registerJob(METHOD, async () => {
      throw new Error('once')
    })
    const demand = await enqueue(METHOD)
    const [d] = await sql`select trigger from background_job where row_id = ${demand}`
    expect(d.trigger).toBe('demand')

    const manual = await admin.post<{ name: string }>('/api/enqueue_job', { method: METHOD, max_attempts: 1 })
    const [m] = await sql`select trigger from background_job where row_id = ${manual.name}`
    expect(m.trigger).toBe('manual')

    await nudgeDueJobs()
    await drainJobs()
    await admin.post('/api/retry_job', { row_id: manual.name })
    const [r] = await sql`select trigger, job_status from background_job where row_id = ${manual.name}`
    expect(r).toMatchObject({ trigger: 'retry', job_status: 'queued' })
  })
})
