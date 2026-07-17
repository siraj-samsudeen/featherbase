import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { drainJobs, loadJobs, retryJob } from '../src/jobs'

// JOB-004: a failed job can be re-queued and re-run.

async function failedJob(admin: TestClient): Promise<string> {
  await loadJobs() // registers ping_job
  const doc = await admin.post<{ name: string }>('/api/resource/Background%20Job', {
    method: 'ping_job',
    status: 'failed',
    attempts: 3,
    max_attempts: 3,
    error: 'boom',
    payload: '{}',
  })
  return doc.name
}

describe('JOB-004: retry failed jobs', () => {
  test('re-queues a failed job and it runs to done', async ({ admin }) => {
    const name = await failedJob(admin)
    expect(await retryJob(name)).toBe(true)

    const [queued] = await sql`select status, attempts from tab_background_job where name = ${name}`
    expect(queued.status).toBe('queued')
    expect(Number(queued.attempts)).toBe(0)

    await drainJobs()
    const [done] = await sql`select status from tab_background_job where name = ${name}`
    expect(done.status).toBe('done')
  })

  test('will not retry a job that is not failed', async () => {
    await loadJobs()
    const [{ name }] = await sql`
      insert into tab_background_job ${sql({
        name: 'jr-notfailed',
        owner: 'Administrator',
        modified_by: 'Administrator',
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
    const name = await failedJob(admin)
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
