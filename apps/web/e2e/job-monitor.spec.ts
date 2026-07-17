import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

let jobName: string

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  // Seed a failed job (a no-op ping_job that will succeed when retried).
  const res = await request.post('/api/resource/Background%20Job', {
    headers,
    data: { method: 'ping_job', status: 'failed', attempts: 3, max_attempts: 3, error: 'simulated failure', payload: '{}' },
  })
  jobName = ((await res.json()) as { name: string }).name
})

// JOB-004: a failed job appears in the monitor; clicking Retry re-runs it.
test('JOB-004: a failed job can be retried from the Desk', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto('/desk/jobs')
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
