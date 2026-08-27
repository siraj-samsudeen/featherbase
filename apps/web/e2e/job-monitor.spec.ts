import { test, expect, adminAuth } from './fixtures'

let jobName: string

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  // Seed a failed job (a no-op ping_job that will succeed when retried).
  const res = await request.post('/api/table/Background%20Job', {
    headers,
    data: { method: 'ping_job', job_status: 'failed', attempts: 3, max_attempts: 3, error: 'simulated failure', payload: '{}' },
  })
  jobName = ((await res.json()) as { row_id: string }).row_id
})

// JOB-004: a failed job appears in the monitor; clicking Retry re-runs it.
test('JOB-004: a failed job can be retried from the Admin', async ({ page }) => {
  await page.goto('/admin/jobs')
  await expect(page.getByTestId('job-monitor')).toBeVisible()

  // The failed job appears with a Retry button.
  await expect(page.getByTestId(`job-status-${jobName}`)).toHaveText('failed')
  await expect(page.getByTestId(`retry-${jobName}`)).toBeVisible()

  // Clicking Retry re-runs it — the no-op job succeeds and the status flips.
  await page.getByTestId(`retry-${jobName}`).click()
  await expect(page.getByTestId(`job-status-${jobName}`)).toHaveText('done', { timeout: 10_000 })
  // The Retry button is gone once it's no longer failed.
  await expect(page.getByTestId(`retry-${jobName}`)).toHaveCount(0)
})
