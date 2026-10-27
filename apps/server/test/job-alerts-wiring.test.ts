import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, loadJobs, registerJob, syncScheduledJobs } from '../src/jobs'

// #464: the worker reaches the alert through a lazy import (job-alerts →
// email → jobs would be a cycle at load). This file never imports
// job-alerts itself, so the worker's own path loads it, and the real email
// queue receives the alert.

const METHOD = 'alert_wiring_probe'

describe('the failure alert, end to end', () => {
  test('a scheduled job that fails for good queues one email per System Manager', async ({ createUser }) => {
    await loadJobs()
    await sql`delete from background_job`
    await sql`delete from job_execution`
    await createUser({ email: 'boss.wiring@example.com', roles: ['System Manager'] })
    await sql`insert into scheduled_job ${sql({
      row_id: METHOD, created_by: 'Administrator', updated_by: 'Administrator',
      method: METHOD, cadence: 'daily', enabled: true,
    })}`
    registerJob(METHOD, async () => {
      throw new Error('the source is unreachable')
    })
    await syncScheduledJobs(METHOD)
    await sql`update background_job set run_at = now() where method = ${METHOD}`

    // Only the probe's own attempts: its alert email queues a send job,
    // which is left for the email suite.
    for (let i = 0; i < 3; i++) await drainJobs(1)

    const mail = await sql`select recipient, subject, body from email_queue where recipient = 'boss.wiring@example.com'`
    expect(mail).toHaveLength(1)
    expect(mail[0].subject).toBe('Scheduled job failed: Alert wiring probe')
    expect(String(mail[0].body)).toContain('What failed: the source is unreachable')
  })
})
