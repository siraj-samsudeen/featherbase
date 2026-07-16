import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { drainJobs, loadJobs, retryJob } from '../src/jobs'
import { areq } from './helpers'

// JOB-004: a failed job can be re-queued and re-run.

async function failedJob(): Promise<string> {
  const res = await areq('/api/resource/Background%20Job', {
    method: 'POST',
    body: JSON.stringify({ method: 'ping_job', status: 'failed', attempts: 3, max_attempts: 3, error: 'boom', payload: '{}' }),
  })
  return ((await res.json()) as { name: string }).name
}

beforeAll(async () => {
  await loadJobs() // registers ping_job
})

afterAll(async () => {
  await sql`delete from tab_background_job where method = 'ping_job'`
  await sql.end()
})

describe('JOB-004: retry failed jobs', () => {
  it('re-queues a failed job and it runs to done', async () => {
    const name = await failedJob()
    expect(await retryJob(name)).toBe(true)

    const [queued] = await sql`select status, attempts from tab_background_job where name = ${name}`
    expect(queued.status).toBe('queued')
    expect(Number(queued.attempts)).toBe(0)

    await drainJobs()
    const [done] = await sql`select status from tab_background_job where name = ${name}`
    expect(done.status).toBe('done')
  })

  it('will not retry a job that is not failed', async () => {
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
    await sql`delete from tab_background_job where name = 'jr-notfailed'`
  })

  it('exposes retry over HTTP (System-Manager-gated) and 417s a non-failed job', async () => {
    const name = await failedJob()
    const ok = await areq('/api/retry_job', { method: 'POST', body: JSON.stringify({ name }) })
    expect(ok.status).toBe(200)
    await drainJobs()
    // Re-retrying the now-done job is rejected.
    const again = await areq('/api/retry_job', { method: 'POST', body: JSON.stringify({ name }) })
    expect(again.status).toBe(417)
  })
})
