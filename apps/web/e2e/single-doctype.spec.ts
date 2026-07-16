import { expect, test } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

// SET-001: a Single DocType opens straight into its form; saving persists;
// there is exactly one record (no list).

test('SET-001: System Settings opens as a form and saves persistently', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  // Navigating to the Single DocType shows its form (no list view).
  await page.goto('/desk/System%20Settings')
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.getByTestId('list-view')).toHaveCount(0)

  // Edit a field and save. Use a unique value so re-runs are always a real
  // change (System Settings is a persistent global single).
  const newName = `Portal ${Date.now()}`
  const appName = page.locator('[data-field=app_name]')
  await expect(appName).toBeVisible()
  await appName.fill(newName)
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')

  // The value persists across reload (the single instance).
  await page.reload()
  await expect(page.locator('[data-field=app_name]')).toHaveValue(newName)

  // Verify via the API that it is a single instance keyed by the doctype.
  const token = await page.evaluate(() => localStorage.getItem('fc_token'))
  const doc = (await (
    await page.request.get('/api/resource/System%20Settings/System%20Settings', {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { name: string; app_name: string }
  expect(doc.name).toBe('System Settings')
  expect(doc.app_name).toBe(newName)
})
