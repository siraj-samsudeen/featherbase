import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, loadJobs, retryJob } from '../src/jobs'

// JOB-004: a failed job can be re-queued and re-run.
//
// Background Job's own delivery state lives on the reserved `status` column
// (src/jobs.ts reads/writes `status`, not the `job_status` column the
// migration also defines but src never touches — see PROGRESS.md). Because
// `status` is reserved, a plain saveDoc insert can never set it directly
// (it's always forced to 'draft') — so a pre-failed row has to be built with
// a raw SQL insert, same as the "will not retry" test below already did.

async function failedJob(): Promise<string> {
  await loadJobs() // registers ping_job
  const [{ name }] = await sql`
    insert into background_job ${sql({
      name: `jr-failed-${Date.now()}`,
      created_by: 'Administrator',
      updated_by: 'Administrator',
      method: 'ping_job',
      status: 'failed',
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

    const [queued] = await sql`select status, attempts from background_job where name = ${name}`
    expect(queued.status).toBe('queued')
    expect(Number(queued.attempts)).toBe(0)

    await drainJobs()
    const [done] = await sql`select status from background_job where name = ${name}`
    expect(done.status).toBe('done')
  })

  test('will not retry a job that is not failed', async () => {
    await loadJobs()
    const [{ name }] = await sql`
      insert into background_job ${sql({
        name: 'jr-notfailed',
        created_by: 'Administrator',
        updated_by: 'Administrator',
        method: 'ping_job',
        status: 'done',
        attempts: 1,
        max_attempts: 3,
        payload: '{}',
      })} returning name`
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
