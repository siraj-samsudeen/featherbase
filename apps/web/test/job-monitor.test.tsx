// The background jobs page: every job's status, attempts and error in one
// list, and a way for an admin to run a failed job again.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

async function seedJob(row_id: string, job_status: string, attempts: number, error: string | null) {
  await sql`insert into background_job ${sql({
    row_id, created_by: 'Administrator', updated_by: 'Administrator',
    method: 'ping_job', job_status, attempts, max_attempts: 3, error, payload: '{}',
    run_at: new Date(Date.now() + 3_600_000),
  })}`
}

test('each job shows whether it is queued, running, done or failed, its attempts and any error, and only a failed one offers a retry', async ({ admin }) => {
  await seedJob('jm-failed', 'failed', 3, 'upstream refused')
  await seedJob('jm-done', 'done', 1, null)
  await seedJob('jm-queued', 'queued', 0, null)
  await renderApp('/featherbase/admin/jobs', admin)

  const failed = await screen.findByTestId('job-jm-failed', {}, { timeout: 10_000 })
  expect(within(failed).getByTestId('job-status-jm-failed')).toHaveTextContent('failed')
  expect(failed).toHaveTextContent('3')
  expect(failed).toHaveTextContent('upstream refused')
  expect(screen.getByTestId('job-status-jm-done')).toHaveTextContent('done')
  expect(screen.getByTestId('job-status-jm-queued')).toHaveTextContent('queued')
  expect(screen.getByTestId('retry-jm-failed')).toBeInTheDocument()
  expect(screen.queryByTestId('retry-jm-done')).not.toBeInTheDocument()
  expect(screen.queryByTestId('retry-jm-queued')).not.toBeInTheDocument()
})

test('retrying a failed job puts it back in the queue to run again', async ({ admin }) => {
  await seedJob('jm-retry', 'failed', 3, 'boom')
  await renderApp('/featherbase/admin/jobs', admin)

  await userEvent.click(await screen.findByTestId('retry-jm-retry'))
  await waitFor(() => expect(screen.getByTestId('job-status-jm-retry')).toHaveTextContent('queued'))
  expect(screen.queryByTestId('retry-jm-retry')).not.toBeInTheDocument()
  const [job] = await sql`select job_status, attempts from background_job where row_id = 'jm-retry'`
  expect(job).toMatchObject({ job_status: 'queued' })
  expect(Number(job.attempts)).toBe(0)
})
