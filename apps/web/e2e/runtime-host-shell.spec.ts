import { test, expect, ensureRuntimeApp, adminAuth, signIn, type APIRequestContext, type Page } from './fixtures'

async function deleteTask(request: APIRequestContext, headers: Record<string, string>, rowId: string) {
  const path = `/api/table/${encodeURIComponent('tasker.task')}/${encodeURIComponent(rowId)}`
  const current = await request.get(path, { headers })
  if (current.status() === 404) return
  if (!current.ok()) throw new Error(`load task cleanup revision: ${current.status()} ${await current.text()}`)
  const { updated_at } = (await current.json()) as { updated_at: string }
  const deleted = await request.delete(`${path}?updated_at=${encodeURIComponent(updated_at)}`, { headers })
  if (!deleted.ok()) throw new Error(`delete task: ${deleted.status()} ${await deleted.text()}`)
}

test.beforeAll(async ({ request }) => {
  await ensureRuntimeApp(request, 'tasker')
  await ensureRuntimeApp(request, 'other')
})

test('runtime shell preserves deep package navigation and refreshes its destinations', async ({ session, request }) => {
  const taskerHeaders = await ensureRuntimeApp(request, 'tasker')
  const saved = await request.post('/api/save_row', {
    headers: taskerHeaders,
    data: { table: 'tasker.task', row: { task_title: 'Host shell deep-link proof' } },
  })
  if (!saved.ok()) throw new Error(`create host-shell task: ${saved.status()} ${await saved.text()}`)
  const task = (await saved.json()) as { row_id: string }
  const location = `/tasker/review/37?filter=a%26b&owner=me#task=${task.row_id}`
  const auth = await adminAuth(request)

  try {
    await signIn(session)
    await session
      .visit(location)
      .assertText('Host shell deep-link proof')
      .step('the complete deep URL remains package-owned', async ({ page }: { page: Page }) => {
        await expect(page).toHaveURL(location)
      })
      .clickLink('Close')
      .step('closing only clears Tasker hash state', async ({ page }: { page: Page }) => {
        await expect(page).toHaveURL('/tasker/review/37?filter=a%26b&owner=me#')
      })
      .clickLink('Host shell deep-link proof')
      .step('opening the task restores the original deep URL', async ({ page }: { page: Page }) => {
        await expect(page).toHaveURL(location)
      })
      .assertHas('[aria-label="Featherbase Home"]')
      .assertSelected('Switch application', 'Tasker')
      .step('the switcher lists each authorized destination once', async ({ page }: { page: Page }) => {
        await expect.poll(async () => (await page.getByRole('combobox', { name: 'Switch application' })
          .locator('option').allTextContents()).sort()).toEqual(['Featherbase Home', 'Other tasks', 'Tasker'])
      })
      .refuteHas('a[aria-label="Featherbase"]')
      .step('Home and the switcher expose consecutive keyboard focus', async ({ page }: { page: Page }) => {
        const home = page.getByRole('link', { name: 'Featherbase Home' })
        const switcher = page.getByRole('combobox', { name: 'Switch application' })
        await home.focus()
        await expect(home).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(switcher).toBeFocused()
      })

    const disabled = await request.post('/api/set_app_enabled', {
      headers: auth,
      data: { name: 'other', enabled: false },
    })
    if (!disabled.ok()) throw new Error(`disable other: ${disabled.status()} ${await disabled.text()}`)
    try {
      await session
        .step('focus refreshes the authorized application catalog', async ({ page }: { page: Page }) => {
          await page.evaluate(() => window.dispatchEvent(new Event('focus')))
          await expect.poll(async () => (await page.getByRole('combobox', { name: 'Switch application' })
            .locator('option').allTextContents()).sort()).toEqual(['Featherbase Home', 'Tasker'])
        })
    } finally {
      const restored = await request.post('/api/set_app_enabled', {
        headers: auth,
        data: { name: 'other', enabled: true },
      })
      if (!restored.ok()) throw new Error(`restore other: ${restored.status()} ${await restored.text()}`)
      await session
        .step('focus reloads the restored application catalog', async ({ page }: { page: Page }) => {
          await page.evaluate(() => window.dispatchEvent(new Event('focus')))
          await expect.poll(async () => (await page.getByRole('combobox', { name: 'Switch application' })
            .locator('option').allTextContents()).sort()).toEqual(['Featherbase Home', 'Other tasks', 'Tasker'])
        })
    }

    await session
      .step('reload keeps the exact package location', async ({ page }: { page: Page }) => {
        await page.reload()
        await expect(page).toHaveURL(location)
      })
      .assertText('Host shell deep-link proof')
      .selectOption('Switch application', 'Featherbase Home')
      .assertHas('[data-testid="awesomebar"]')
      .assertHas('[data-testid="session-user"]')
      .assertHas('[data-testid="admin-sidebar"]')
      .refuteHas('a[aria-label="Tasker"]')
      .assertSelected('Switch application', 'Featherbase Home')
      .step('Admin lists the same authorized destinations', async ({ page }: { page: Page }) => {
        await expect.poll(async () => (await page.getByRole('combobox', { name: 'Switch application' })
          .locator('option').allTextContents()).sort()).toEqual(['Featherbase Home', 'Other tasks', 'Tasker'])
      })
      .step('narrow Admin keeps identifiable touch-sized controls and visible focus', async ({ page }: { page: Page }) => {
        await page.setViewportSize({ width: 375, height: 812 })
        const home = page.getByRole('link', { name: 'Featherbase Home' })
        const switcher = page.getByRole('combobox', { name: 'Switch application' })
        const search = page.getByPlaceholder('Search or type a command…')
        await expect(home).toBeVisible()
        await expect(switcher).toHaveValue('/featherbase/admin')
        const homeBox = await home.boundingBox()
        const switcherBox = await switcher.boundingBox()
        const searchBox = await search.boundingBox()
        expect(homeBox?.width).toBeGreaterThanOrEqual(44)
        expect(homeBox?.height).toBeGreaterThanOrEqual(44)
        expect(switcherBox?.width).toBeGreaterThanOrEqual(152)
        expect(switcherBox?.height).toBeGreaterThanOrEqual(44)
        expect(searchBox?.width).toBeGreaterThanOrEqual(280)
        const headerRight = await page.locator('header').first().evaluate(element => element.getBoundingClientRect().right)
        const accountRight = await page.getByTestId('session-user').evaluate(element => element.getBoundingClientRect().right)
        expect(headerRight).toBeLessThanOrEqual(375)
        expect(accountRight).toBeLessThanOrEqual(375)
        await home.focus()
        await expect(home).toBeFocused()
        const focus = await home.evaluate(element => {
          const style = getComputedStyle(element)
          return { outline: style.outlineStyle, shadow: style.boxShadow }
        })
        expect(focus.outline !== 'none' || focus.shadow !== 'none').toBe(true)
        await page.screenshot({ path: '../../.amp/in/artifacts/runtime-host-shell-admin-mobile.png', fullPage: true })
      })
  } finally {
    await deleteTask(request, taskerHeaders, task.row_id)
  }
})

test('runtime shell leaves an app whose access disappears', async ({ session, request }) => {
  const auth = await adminAuth(request)
  await signIn(session)
  await session
    .visit('/other/review/37?owner=all')
    .assertSelected('Switch application', 'Other tasks')
    .clickLink('Selected task')
    .step('a package hash link retains its deep path and query', async ({ page }: { page: Page }) => {
      await expect(page).toHaveURL('/other/review/37?owner=all#task=1')
    })
    .clickLink('My tasks')
    .step('a package query link retains its deep path', async ({ page }: { page: Page }) => {
      await expect(page).toHaveURL('/other/review/37?owner=me')
    })

  const disabled = await request.post('/api/set_app_enabled', {
    headers: auth,
    data: { name: 'other', enabled: false },
  })
  if (!disabled.ok()) throw new Error(`disable current app: ${disabled.status()} ${await disabled.text()}`)
  try {
    await session
      .step('catalog refresh leaves a destination that is no longer authorized', async ({ page }: { page: Page }) => {
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await expect(page).toHaveURL(/\/featherbase\/admin(?:\/|$)/)
      })
      .assertSelected('Switch application', 'Featherbase Home')
  } finally {
    const restored = await request.post('/api/set_app_enabled', {
      headers: auth,
      data: { name: 'other', enabled: true },
    })
    if (!restored.ok()) throw new Error(`restore current app: ${restored.status()} ${await restored.text()}`)
  }
})

test.describe('coarse-pointer mobile runtime shell', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })

  test('shell remains usable without obscuring Tasker on coarse-pointer mobile', async ({ session, request }) => {
    const headers = await ensureRuntimeApp(request, 'tasker')
    const saved = await request.post('/api/save_row', {
      headers,
      data: { table: 'tasker.task', row: { task_title: 'Host shell mobile proof' } },
    })
    if (!saved.ok()) throw new Error(`create mobile host-shell task: ${saved.status()} ${await saved.text()}`)
    const task = (await saved.json()) as { row_id: string }

    try {
      await signIn(session)
      await session
        .visit('/tasker/')
        .assertHas('[aria-label="Featherbase Home"]')
        .assertHas('[aria-label="Switch application"]')
        .assertHas('[placeholder="What do you need to remember?"]')
        .step('mobile controls clear the measured host shell', async ({ page }: { page: Page }) => {
          expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
          const homeBox = await page.getByRole('link', { name: 'Featherbase Home' }).boundingBox()
          const switcherBox = await page.getByRole('combobox', { name: 'Switch application' }).boundingBox()
          const shellBox = await page.locator('[data-testid="runtime-shell"]').boundingBox()
          const pageBox = await page.getByTestId('task-management-page').boundingBox()
          expect(homeBox?.height).toBeGreaterThanOrEqual(44)
          expect(switcherBox?.height).toBeGreaterThanOrEqual(44)
          expect(pageBox?.y).toBeGreaterThanOrEqual((shellBox?.y ?? 0) + (shellBox?.height ?? 0))
        })
        .clickLink('Host shell mobile proof')
        .clickButton('Inspector')
        .assertHas('.tasker-inspector')
        .assertText('Close')
        .clickButton('Focus')
        .assertHas('.tasker-focus-detail')
        .step('fixed details clear the measured host shell', async ({ page }: { page: Page }) => {
          const shellBox = await page.locator('[data-testid="runtime-shell"]').boundingBox()
          const detailBox = await page.locator('.tasker-focus-detail').boundingBox()
          expect(detailBox?.y).toBeGreaterThanOrEqual((shellBox?.y ?? 0) + (shellBox?.height ?? 0))
          await page.screenshot({ path: '../../.amp/in/artifacts/runtime-host-shell-mobile-detail.png', fullPage: true })
        })
    } finally {
      await deleteTask(request, headers, task.row_id)
    }
  })
})
