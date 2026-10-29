import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, enqueue, loadJobs, registerJob, retryJob, syncScheduledJobs } from '../src/jobs'
import { _setJobAlertSender, JOB_ALERT_SUBJECT } from '../src/job-alerts'
import { queueEmail, type MailMessage } from '../src/email'

// #464: the Jobs page and its alerts. A scheduled job's run ends ok, failed
// or refused; a run that fails for good or refuses emails every System
// Manager once, in plain words, through the shared recipients helper (#463).
//
// Sandbox note: now() is frozen at the test transaction's BEGIN while the
// worker stamps run_at from the wall clock, so due entries are nudged onto
// the transaction clock before draining (the scheduled-jobs.test.ts shim).

const METHOD = 'alert_probe'
const ADHOC = 'alert_probe_unscheduled'

let sent: MailMessage[] = []

async function setup({ enabled = true } = {}) {
  await loadJobs()
  await sql`delete from background_job`
  await sql`delete from job_execution`
  await sql`delete from scheduled_job where method in ${sql([METHOD, ADHOC])}`
  await sql`insert into scheduled_job ${sql({
    row_id: METHOD, created_by: 'Administrator', updated_by: 'Administrator',
    method: METHOD, cadence: 'hourly', enabled,
  })}`
  sent = []
  _setJobAlertSender(async (m) => {
    sent.push(m)
  })
}

afterEach(() => _setJobAlertSender(null))

async function runDue(limit?: number) {
  await sql`
    update background_job set run_at = now()
    where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
  return drainJobs(limit)
}

async function scheduledRow() {
  const [row] = await sql`select last_outcome, last_result from scheduled_job where method = ${METHOD}`
  return row
}

describe('a scheduled job that fails emails the System Managers', () => {
  test('once, after its last attempt, naming the job and what failed', async ({ createUser }) => {
    await setup()
    await createUser({ email: 'boss.alerts@example.com', roles: ['System Manager'] })
    registerJob(METHOD, async () => {
      throw new Error('the warehouse did not answer')
    })
    await syncScheduledJobs(METHOD)

    await runDue()

    const mine = sent.filter((m) => m.to === 'boss.alerts@example.com')
    expect(mine).toHaveLength(1)
    expect(mine[0].subject).toBe(`${JOB_ALERT_SUBJECT.failed}: Alert probe`)
    expect(mine[0].body).toContain('The scheduled job "Alert probe" failed')
    expect(mine[0].body).toContain('after 3 attempts')
    expect(mine[0].body).toContain('What failed: the warehouse did not answer')
    expect(mine[0].body).toContain('/featherbase/admin/jobs')
    expect(await scheduledRow()).toEqual({ last_outcome: 'error', last_result: 'the warehouse did not answer' })
  })

  test('an attempt that will be retried emails nobody', async ({ createUser }) => {
    await setup()
    await createUser({ email: 'boss.retry@example.com', roles: ['System Manager'] })
    let calls = 0
    registerJob(METHOD, async () => {
      calls++
      if (calls === 1) throw new Error('blip')
    })
    await syncScheduledJobs(METHOD)
    await runDue()
    expect(calls).toBe(2)
    expect(sent).toEqual([])
    expect(await scheduledRow()).toEqual({ last_outcome: 'success', last_result: null })
  })

  test('a job with no Scheduled Job row emails nobody when it fails', async ({ createUser }) => {
    await setup()
    await createUser({ email: 'boss.adhoc@example.com', roles: ['System Manager'] })
    registerJob(ADHOC, async () => {
      throw new Error('nope')
    })
    await enqueue(ADHOC, {}, { maxAttempts: 1 })
    await runDue()
    expect(sent).toEqual([])
  })

  test('with no System Manager to mail, the alert is recorded as undelivered, not dropped', async () => {
    await setup()
    await sql`update person set email = null where row_id in (select parent from has_role where role = 'System Manager')`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerJob(METHOD, async () => {
      throw new Error('broken')
    })
    await syncScheduledJobs(METHOD)
    await runDue()
    expect(sent).toEqual([])
    const rows = await sql`select operation from activity_log where operation like 'notice_undelivered:%'`
    expect(rows.map((r) => r.operation)).toEqual([
      'notice_undelivered: no System Manager has an email address (job alert: alert_probe)',
    ])
    expect(warn.mock.calls.some((c) => String(c[0]).includes('notice_undelivered'))).toBe(true)
  })

  test('a run that succeeds emails nobody and keeps its one-line result', async ({ createUser }) => {
    await setup()
    await createUser({ email: 'boss.ok@example.com', roles: ['System Manager'] })
    registerJob(METHOD, async (_p, ctx) => ctx.setResult('3 reports sent'))
    await syncScheduledJobs(METHOD)
    await runDue()
    expect(sent).toEqual([])
    expect(await scheduledRow()).toEqual({ last_outcome: 'success', last_result: '3 reports sent' })
  })
})

describe('one email per episode, not per run', () => {
  test('a partly queued alert rolls back and the next failure queues every recipient once', async ({ createUser }) => {
    await setup({ enabled: false })
    await createUser({ email: 'boss.partial-one@example.com', roles: ['System Manager'] })
    await createUser({ email: 'boss.partial-two@example.com', roles: ['System Manager'] })
    registerJob(METHOD, async () => { throw new Error('still down') })
    _setJobAlertSender(async (message) => {
      await queueEmail(message)
      throw new Error('alert queue interrupted')
    })
    await enqueue(METHOD, {}, { trigger: 'manual', maxAttempts: 1 })
    await runDue(1)
    const subject = `${JOB_ALERT_SUBJECT.failed}: Alert probe`
    expect(await sql`select recipient from email_queue where subject = ${subject}`).toEqual([])
    expect(await scheduledRow()).toEqual({ last_outcome: 'error', last_result: 'still down' })
    expect(await sql`select job_status, attempts from background_job where method = ${METHOD}`)
      .toEqual([{ job_status: 'failed', attempts: 1 }])

    _setJobAlertSender(null)
    await enqueue(METHOD, {}, { trigger: 'manual', maxAttempts: 1 })
    await runDue(1)
    const queued = await sql`
      select recipient from email_queue where subject = ${subject}
      and recipient in ('boss.partial-one@example.com', 'boss.partial-two@example.com') order by recipient`
    expect(queued.map((m) => m.recipient)).toEqual(['boss.partial-one@example.com', 'boss.partial-two@example.com'])
  })

  test('retrying the same failed queue row does not email the episode again', async ({ createUser }) => {
    await setup({ enabled: false })
    await createUser({ email: 'boss.same-row@example.com', roles: ['System Manager'] })
    registerJob(METHOD, async () => { throw new Error('still down') })
    const job = await enqueue(METHOD, {}, { trigger: 'manual', maxAttempts: 1 })
    await runDue()
    expect(sent.filter((m) => m.to === 'boss.same-row@example.com')).toHaveLength(1)

    expect(await retryJob(job)).toBe(true)
    await runDue()
    expect(sent.filter((m) => m.to === 'boss.same-row@example.com')).toHaveLength(1)
  })

  test('a job failing run after run mails once; after a run that worked, the next failure mails again', async ({ createUser }) => {
    await setup()
    await createUser({ email: 'boss.episode@example.com', roles: ['System Manager'] })
    let fail = true
    registerJob(METHOD, async () => {
      if (fail) throw new Error('down')
    })
    const runOnce = async () => {
      await enqueue(METHOD, {}, { trigger: 'schedule', maxAttempts: 1 })
      await runDue()
      await sql`delete from background_job where method = ${METHOD} and job_status = 'queued'`
    }
    const mine = () => sent.filter((m) => m.to === 'boss.episode@example.com')
    await runOnce()
    await runOnce()
    await runOnce()
    expect(mine()).toHaveLength(1)
    fail = false
    await runOnce()
    fail = true
    await runOnce()
    expect(mine()).toHaveLength(2)
  })

  test('a refusal after a failure is a new problem and mails', async ({ createUser }) => {
    await setup()
    await createUser({ email: 'boss.change@example.com', roles: ['System Manager'] })
    let refuse = false
    registerJob(METHOD, async (_p, ctx) => {
      if (refuse) return ctx.refuse('feed stale')
      throw new Error('down')
    })
    await enqueue(METHOD, {}, { trigger: 'manual', maxAttempts: 1 })
    await runDue()
    refuse = true
    await enqueue(METHOD, {}, { trigger: 'manual', maxAttempts: 1 })
    await runDue()
    expect(sent.filter((m) => m.to === 'boss.change@example.com').map((m) => m.subject)).toEqual([
      `${JOB_ALERT_SUBJECT.failed}: Alert probe`,
      `${JOB_ALERT_SUBJECT.refused}: Alert probe`,
    ])
  })
})

describe('what the email says', () => {
  test('a run started by hand that fails on its last attempt mails too, with the first line of the error only', async ({ createUser }) => {
    await setup({ enabled: false })
    await createUser({ email: 'boss.manual@example.com', roles: ['System Manager'] })
    registerJob(METHOD, async () => {
      throw new Error(`duplicate key\n${'detail '.repeat(100)}`)
    })
    await enqueue(METHOD, {}, { trigger: 'manual', maxAttempts: 1 })
    await runDue()
    const mine = sent.filter((m) => m.to === 'boss.manual@example.com')
    expect(mine).toHaveLength(1)
    expect(mine[0].body).toContain('What failed: duplicate key\n')
    expect(mine[0].body).not.toContain('detail')
  })

  test('a refusal keeps its reason even if the job sets a result afterwards', async () => {
    await setup()
    registerJob(METHOD, async (_p, ctx) => {
      ctx.refuse('too many at once')
      ctx.setResult('done')
    })
    await syncScheduledJobs(METHOD)
    await runDue()
    expect(await scheduledRow()).toEqual({ last_outcome: 'refused', last_result: 'too many at once' })
  })
})

describe('only a System Manager can switch or run a job', () => {
  test('anyone else is refused', async ({ admin, createUser }) => {
    await setup()
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Shelf Clerk' } })
    const clerk = await createUser({ email: 'clerk.jobs@example.com', roles: ['Shelf Clerk'] })
    const [row] = await sql`select updated_at from scheduled_job where method = ${METHOD}`
    await expect(
      clerk.post('/api/save_row', {
        table: 'Scheduled Job',
        row: { row_id: METHOD, method: METHOD, cadence: 'hourly', enabled: false, updated_at: (row.updated_at as Date).toISOString() },
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(clerk.post('/api/enqueue_job', { method: METHOD })).rejects.toMatchObject({ status: 403 })
    const [after] = await sql`select enabled from scheduled_job where method = ${METHOD}`
    expect(after.enabled).toBe(true)
    expect(await sql`select 1 from background_job where method = ${METHOD}`).toHaveLength(0)
  })
})

describe('a run that refuses to act is treated like a failure', () => {
  test('it is recorded as refused, not retried, emails once, and the schedule carries on', async ({ createUser }) => {
    await setup()
    await createUser({ email: 'boss.refuse@example.com', roles: ['System Manager'] })
    let calls = 0
    registerJob(METHOD, async (_p, ctx) => {
      calls++
      ctx.refuse('the feed is 3 days old')
    })
    await syncScheduledJobs(METHOD)
    const [queued] = await sql`select row_id from background_job where method = ${METHOD} and job_status = 'queued'`

    await runDue()

    expect(calls).toBe(1)
    const [exec] = await sql`select outcome, result, attempt from job_execution where job = ${String(queued.row_id)}`
    expect({ ...exec, attempt: Number(exec.attempt) }).toEqual({ outcome: 'refused', result: 'the feed is 3 days old', attempt: 1 })
    const [job] = await sql`select job_status from background_job where row_id = ${String(queued.row_id)}`
    expect(job.job_status).toBe('done')
    expect(await scheduledRow()).toEqual({ last_outcome: 'refused', last_result: 'the feed is 3 days old' })
    const next = await sql`select 1 from background_job where method = ${METHOD} and job_status = 'queued'`
    expect(next).toHaveLength(1)

    const mine = sent.filter((m) => m.to === 'boss.refuse@example.com')
    expect(mine).toHaveLength(1)
    expect(mine[0].subject).toBe(`${JOB_ALERT_SUBJECT.refused}: Alert probe`)
    expect(mine[0].body).toContain('The scheduled job "Alert probe" refused to act')
    expect(mine[0].body).toContain('Why: the feed is 3 days old')
  })
})

describe('the run outcomes are data the Admin can read', () => {
  test('refused is a run outcome, and a Scheduled Job shows its last result read-only', async () => {
    const cols = await sql`
      select parent, column_name, choices, read_only from column_def
      where (parent = 'Job Execution' and column_name = 'outcome')
         or (parent = 'Scheduled Job' and column_name in ('last_outcome', 'last_result'))
      order by parent, column_name`
    expect(cols.map((c) => [c.parent, c.column_name, c.choices, c.read_only])).toEqual([
      ['Job Execution', 'outcome', 'success\nerror\nrefused', expect.anything()],
      ['Scheduled Job', 'last_outcome', 'success\nerror\nrefused', true],
      ['Scheduled Job', 'last_result', null, true],
    ])
  })
})
