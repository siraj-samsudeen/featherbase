import { test, expect, ensureRuntimeApp, admitTaskerAdmin, signIn, type APIRequestContext, type Page } from './fixtures'

// An app with its own screen (Tasker, and the `other` fixture) owns its deep
// address under the platform's shared top bar (#650, design D3: the bar
// replaced the runtime shell's header and its app switcher).

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
  await admitTaskerAdmin(request)
  await ensureRuntimeApp(request, 'other')
})

// Deliberate deep link: an installed app can ship another HTML document
// whose relative scripts must resolve beside that document, not the SPA root.
test("an app's nested help document loads its own relative script", async ({ session }) => {
  await session.visit('/tasker/help/index.html').assertText('Tasker help')
  await session.step('the nested document script executes', async ({ page }) => {
    await expect(page.locator('body')).toHaveAttribute('data-tasker-help', 'ready')
  })
})

test("an app keeps its deep address under the shared bar, and the dropdown leaves for Featherbase", async ({ session, request }) => {
  const taskerHeaders = await ensureRuntimeApp(request, 'tasker')
  const saved = await request.post('/api/save_row', {
    headers: taskerHeaders,
    data: { table: 'tasker.task', row: { task_title: 'Host shell deep-link proof' } },
  })
  if (!saved.ok()) throw new Error(`create host-shell task: ${saved.status()} ${await saved.text()}`)
  const task = (await saved.json()) as { row_id: string }
  const location = `/tasker/review/37?filter=a%26b&owner=me#task=${task.row_id}`

  try {
    await signIn(session)
    await session
      .visit(location)
      .assertText('Host shell deep-link proof')
      .step('the complete deep URL remains the app\'s own', async ({ page }: { page: Page }) => {
        await expect(page).toHaveURL(location)
      })
      .clickLink('Close')
      .step('closing only clears Tasker hash state', async ({ page }: { page: Page }) => {
        await expect(page).toHaveURL('/tasker/review/37?filter=a%26b&owner=me#')
      })
      .within('.tasker-nav-inbox', tab => tab.click('Inbox'))
      .clickLink('Host shell deep-link proof')
      .step('opening the task restores the original deep URL', async ({ page }: { page: Page }) => {
        await expect(page).toHaveURL(location)
      })
      .step("the shared dropdown names the app", async ({ page }: { page: Page }) => {
        await expect(page.getByRole('combobox', { name: 'Switch application' })).toHaveValue('/tasker/')
      })
      .step('reload keeps the exact app location', async ({ page }: { page: Page }) => {
        await page.reload()
        await expect(page).toHaveURL(location)
        await expect(page.getByTestId('top-bar-name')).toHaveValue('/tasker/')
      })
      .assertText('Host shell deep-link proof')
      .step('the dropdown opens Featherbase', async ({ page }: { page: Page }) => {
        await page.getByRole('combobox', { name: 'Switch application' }).selectOption('/featherbase/admin')
        await expect(page).toHaveURL(/\/featherbase\/admin(?:\/|$)/)
        await expect(page.getByTestId('admin-sidebar')).toBeVisible()
      })
  } finally {
    await deleteTask(request, taskerHeaders, task.row_id)
  }
})

test("an app's own hash and query links keep its deep path under the bar", async ({ session }) => {
  await signIn(session)
  await session
    .visit('/other/review/37?owner=all')
    .step('the bar names the app', async ({ page }: { page: Page }) => {
      await expect(page.getByTestId('top-bar-name')).toHaveValue('/other/')
    })
    .clickLink('Selected task')
    .step('an app hash link retains its deep path and query', async ({ page }: { page: Page }) => {
      await expect(page).toHaveURL('/other/review/37?owner=all#task=1')
    })
    .clickLink('My tasks')
    .step('an app query link retains its deep path', async ({ page }: { page: Page }) => {
      await expect(page).toHaveURL('/other/review/37?owner=me')
    })
})

test('Tasker content and shared navigation follow the selected theme without losing the capture draft', async ({ session }) => {
  await signIn(session)
  await session
    .visit('/tasker/')
    .within('.tasker-nav-inbox', tab => tab.click('Inbox'))
    .fillIn('Quick capture', 'Draft retained across theme changes')
    .step('Tasker and both navigation surfaces follow each choice', async ({ page }) => {
      const colors: string[] = []
      for (const name of ['Dark', 'Light']) {
        await page.getByRole('radio', { name, exact: true }).click()
        const color = await page.getByTestId('top-bar').evaluate(element => getComputedStyle(element).backgroundColor)
        await expect(page.getByRole('navigation', { name: 'Task views' }).locator('.sidebar-frame')).toHaveCSS('background-color', color)
        colors.push(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor))
        await expect(page.getByRole('textbox', { name: 'Quick capture', exact: true })).toHaveValue('Draft retained across theme changes')
      }
      expect(colors[0]).not.toBe(colors[1])
      await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeChecked()
    })
})

test.describe('coarse-pointer phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })

  test("Tasker's page starts below the shared bar on a phone, and nothing scrolls sideways", async ({ session }) => {
    await signIn(session)
    await session
      .visit('/tasker/').within('.tasker-nav-inbox', tab => tab.click('Inbox'))
      .assertHas('[id="quick-capture"]')
      .step('the page starts below the bar', async ({ page }: { page: Page }) => {
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
        const bar = (await page.getByTestId('top-bar').boundingBox())!
        const pageBox = (await page.getByTestId('task-management-page').boundingBox())!
        expect(pageBox.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      })
  })

  // #650, fixed in #702: pinned panels consume the shared bar's published
  // height, so their top controls remain reachable by real pointer input.
  test("Tasker's inspector, pinned to the window, starts below the shared bar on a phone", async ({ session, request }) => {
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
        .visit('/tasker/').within('.tasker-nav-inbox', tab => tab.click('Inbox'))
        .clickLink('Host shell mobile proof')
        .step("the inspector is pinned at the bar's height, not at the window's top", async ({ page }: { page: Page }) => {
          await expect(page.getByTestId('top-bar')).toHaveCount(1)
          await page.getByRole('button', { name: 'Inspector' }).click()
          await expect(page.locator('.tasker-inspector')).toBeVisible()
          await expect.poll(() => page.locator('.tasker-inspector').evaluate((inspector) => {
            const height = getComputedStyle(document.documentElement).getPropertyValue('--featherbase-bar-height')
            return Math.abs(parseFloat(getComputedStyle(inspector).top) - parseFloat(height))
          })).toBeLessThan(1)
        })
        .clickLink('Close')
        .assertHas('.tasker-inspector', { count: 0 })
        .clickLink('Host shell mobile proof')
        .assertHas('.tasker-inspector', { count: 1 })
    } finally {
      await deleteTask(request, headers, task.row_id)
    }
  })
})
