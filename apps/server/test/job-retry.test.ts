import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, loadJobs, retryJob } from '../src/jobs'

// JOB-004: a failed job can be re-queued and re-run.
//
// Background Job's own delivery state lives on `job_status` (src/jobs.ts
// reads/writes it), a dedicated column distinct from the reserved `status`
// every Table gets for its draft/submitted/cancelled lifecycle — the two
// used to collide on the same column name, which meant a plain saveDoc
// insert could never set a job's delivery state directly (it was always
// forced to 'draft'). A pre-failed row is still built with a raw SQL insert
// here for setup convenience, same as the "will not retry" test below.

async function failedJob(): Promise<string> {
  await loadJobs() // registers ping_job
  const [{ name }] = await sql`
    insert into background_job ${sql({
      row_id: `jr-failed-${Date.now()}`,
      created_by: 'Administrator',
      updated_by: 'Administrator',
      method: 'ping_job',
      job_status: 'failed',
      attempts: 3,
      max_attempts: 3,
      error: 'boom',
      payload: '{}',
    })} returning name`
  return name as string
}

describe('JOB-004: retry failed jobs', () => {
  test('re-queues a failed job and it runs to done', async () => {
    const name = await failedJob()
    expect(await retryJob(name)).toBe(true)

    const [queued] = await sql`select job_status, attempts from background_job where row_id = ${name}`
    expect(queued.job_status).toBe('queued')
    expect(Number(queued.attempts)).toBe(0)

    await drainJobs()
    const [done] = await sql`select job_status from background_job where row_id = ${name}`
    expect(done.job_status).toBe('done')
  })

  test('will not retry a job that is not failed', async () => {
    await loadJobs()
    const [{ name }] = await sql`
      insert into background_job ${sql({
        row_id: 'jr-notfailed',
        created_by: 'Administrator',
        updated_by: 'Administrator',
        method: 'ping_job',
        job_status: 'done',
        attempts: 1,
        max_attempts: 3,
        payload: '{}',
      })} returning row_id`
    expect(await retryJob(name as string)).toBe(false)
  })

  test('exposes retry over HTTP (System-Manager-gated) and 417s a non-failed job', async ({
    admin,
  }) => {
    const name = await failedJob()
    const ok = await admin.fetch('/api/retry_job', {
      method: 'POST',
      body: JSON.stringify({ name }),
      headers: { 'content-type': 'application/json' },
    })
    expect(ok.status).toBe(200)
    await drainJobs()
    // Re-retrying the now-done job is rejected.
    const again = await admin.fetch('/api/retry_job', {
      method: 'POST',
      body: JSON.stringify({ name }),
      headers: { 'content-type': 'application/json' },
    })
    expect(again.status).toBe(417)
  })
})
