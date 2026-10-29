import { test, expect, adminAuth } from './fixtures'

test.use({ viewport: { width: 375, height: 812 } })

test('a phone schedule card exposes one working switch without horizontal scrolling', async ({ session, request }) => {
  const headers = await adminAuth(request)
  const made = await request.post('/api/save_row', {
    headers,
    data: { table: 'Scheduled Job', row: { method: 'coverage_phone', cadence: 'daily', enabled: false } },
  })
  expect(made.status()).toBe(201)
  const { row_id } = await made.json() as { row_id: string }
  // Deep link isolates the phone card, whose switch is a different rendered
  // control from the desktop table tested in jobs-page.test.tsx.
  await session.visit('/featherbase/admin/jobs').step('the card switch changes its stored schedule', async ({ page }) => {
    const card = page.getByTestId('scheduled-job-coverage_phone')
    const toggle = card.getByRole('switch', { name: 'Run Coverage phone on its schedule' })
    await expect(toggle).toHaveCount(1)
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    const saved = await request.get(`/api/table/Scheduled%20Job/${encodeURIComponent(row_id)}`, { headers })
    expect(saved.status()).toBe(200)
    expect(await saved.json()).toMatchObject({ enabled: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})
