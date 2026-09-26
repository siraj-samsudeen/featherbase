import { test, expect, ensureRuntimeApp, adminAuth } from './fixtures'

test.beforeAll(async ({ request }) => {
  await ensureRuntimeApp(request, 'tasker')
  await ensureRuntimeApp(request, 'other')
})

test('runtime shell preserves a deep Tasker location and one live keyboard switcher', async ({ page, request }) => {
  const headers = await ensureRuntimeApp(request, 'tasker')
  const saved = await request.post('/api/save_row', {
    headers,
    data: { table: 'tasker.task', row: { task_title: 'Host shell deep-link proof' } },
  })
  expect(saved.ok()).toBe(true)
  const task = (await saved.json()) as { row_id: string }
  const location = `/tasker/review/37?filter=a%26b&owner=me#task=${task.row_id}`

  await page.goto(location)
  await expect(page).toHaveURL(location)
  await expect(page.getByRole('heading', { name: 'Host shell deep-link proof' })).toBeVisible()
  await page.getByRole('link', { name: 'Close' }).click()
  await expect(page).toHaveURL('/tasker/review/37?filter=a%26b&owner=me#')
  await page.getByRole('link', { name: 'Host shell deep-link proof' }).click()
  await expect(page).toHaveURL(location)
  const home = page.getByRole('link', { name: 'Featherbase Home' })
  const switcher = page.getByRole('combobox', { name: 'Switch application' })
  await expect(home).toBeVisible()
  await expect(switcher).toHaveValue('/tasker/')
  await expect(switcher.locator('option').first()).toHaveText('Featherbase Home')
  expect(new Set(await switcher.locator('option').allTextContents())).toEqual(new Set(['Featherbase Home', 'Other tasks', 'Tasker']))
  await expect(page.getByRole('link', { name: 'Featherbase', exact: true })).toHaveCount(0)

  await home.focus()
  await expect(home).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(switcher).toBeFocused()

  const auth = await adminAuth(request)
  expect((await request.post('/api/set_app_enabled', { headers: auth, data: { name: 'other', enabled: false } })).ok()).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(new Set(await switcher.locator('option').allTextContents())).toEqual(new Set(['Featherbase Home', 'Tasker']))
  expect((await request.post('/api/set_app_enabled', { headers: auth, data: { name: 'other', enabled: true } })).ok()).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(switcher.locator('option')).toHaveCount(3)
  expect(new Set(await switcher.locator('option').allTextContents())).toEqual(new Set(['Featherbase Home', 'Other tasks', 'Tasker']))

  await page.reload()
  await expect(page).toHaveURL(location)
  await expect(page.getByRole('heading', { name: 'Host shell deep-link proof' })).toBeVisible()
  await page.screenshot({ path: '../../.amp/in/artifacts/runtime-host-shell-desktop.png', fullPage: true })

  await switcher.selectOption('/featherbase/admin')
  await expect(page).toHaveURL(/\/featherbase\/admin/)
  await expect(page.getByTestId('awesomebar')).toBeVisible()
  await expect(page.getByTestId('session-user')).toBeVisible()
  await expect(page.getByTestId('admin-sidebar')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tasker' })).toHaveCount(0)
  const adminSwitcher = page.getByRole('combobox', { name: 'Switch application' })
  await expect(adminSwitcher).toHaveValue('/featherbase/admin')
  expect(new Set(await adminSwitcher.locator('option').allTextContents())).toEqual(new Set(['Featherbase Home', 'Other tasks', 'Tasker']))
})

test.describe('coarse-pointer mobile runtime shell', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })

  test('shell remains usable without obscuring Tasker on coarse-pointer mobile', async ({ page }) => {
    await page.goto('/tasker/')
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    const home = page.getByRole('link', { name: 'Featherbase Home' })
    const switcher = page.getByRole('combobox', { name: 'Switch application' })
    await expect(home).toBeVisible()
    await expect(switcher).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Quick capture' })).toBeVisible()
    const homeBox = await home.boundingBox()
    const switcherBox = await switcher.boundingBox()
    expect(homeBox?.height).toBeGreaterThanOrEqual(44)
    expect(switcherBox?.height).toBeGreaterThanOrEqual(44)
    expect((await page.locator('[data-testid="runtime-shell"]').boundingBox())?.height).toBe(48)
    expect((await page.getByTestId('task-management-page').boundingBox())?.y).toBeGreaterThanOrEqual(48)
    await page.screenshot({ path: '../../.amp/in/artifacts/runtime-host-shell-mobile.png', fullPage: true })

    await page.getByRole('link', { name: 'Host shell deep-link proof' }).click()
    await page.getByRole('button', { name: 'Inspector' }).click()
    expect((await page.locator('.tasker-inspector').boundingBox())?.y).toBeGreaterThanOrEqual(48)
    await expect(page.getByRole('link', { name: 'Close' })).toBeVisible()
    await page.getByRole('button', { name: 'Focus' }).click()
    expect((await page.locator('.tasker-focus-detail').boundingBox())?.y).toBeGreaterThanOrEqual(48)
    await page.screenshot({ path: '../../.amp/in/artifacts/runtime-host-shell-mobile-detail.png', fullPage: true })
  })
})
