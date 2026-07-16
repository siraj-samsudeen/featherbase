import { expect, test } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

// JOB-005: a long-running job reports progress to the client over realtime.
test('JOB-005: a long job reports live progress to the Desk', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto('/desk/jobs')
  await expect(page.getByTestId('job-monitor')).toBeVisible()
  // Give the realtime socket a moment to connect + subscribe before enqueuing.
  await page.waitForTimeout(1000)

  await page.getByTestId('run-demo-job').click()

  // The progress widget appears and climbs to 100% via realtime events.
  await expect(page.getByTestId('demo-progress')).toBeVisible()
  await expect(page.getByTestId('demo-progress-percent')).toHaveText('100%', { timeout: 10_000 })
  // The final progress message was delivered.
  await expect(page.getByTestId('demo-progress')).toContainText('step 5 of 5')
})
