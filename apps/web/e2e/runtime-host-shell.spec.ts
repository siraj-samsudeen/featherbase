import { test, expect, ensureRuntimeApp, signIn, type APIRequestContext, type Page } from './fixtures'

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
  await ensureRuntimeApp(request, 'other')
})

test("an app keeps its deep address under the shared bar, and Open Admin leaves for the Admin", async ({ session, request }) => {
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
      .clickLink('Host shell deep-link proof')
      .step('opening the task restores the original deep URL', async ({ page }: { page: Page }) => {
        await expect(page).toHaveURL(location)
      })
      .step("the shared bar names the app, with no app switcher", async ({ page }: { page: Page }) => {
        await expect(page.getByTestId('top-bar-name')).toHaveText('Tasker')
        await expect(page.getByRole('combobox', { name: 'Switch application' })).toHaveCount(0)
      })
      .step('reload keeps the exact app location', async ({ page }: { page: Page }) => {
        await page.reload()
        await expect(page).toHaveURL(location)
        await expect(page.getByTestId('top-bar-name')).toHaveText('Tasker')
      })
      .assertText('Host shell deep-link proof')
      .step('Open Admin loads the Admin screens', async ({ page }: { page: Page }) => {
        await page.getByTestId('open-admin').click()
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
      await expect(page.getByTestId('top-bar-name')).toHaveText('Other tasks')
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

test.describe('coarse-pointer phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })

  test("Tasker's page starts below the shared bar on a phone, and nothing scrolls sideways", async ({ session }) => {
    await signIn(session)
    await session
      .visit('/tasker/')
      .assertHas('[placeholder="What do you need to remember?"]')
      .step('the page starts below the bar', async ({ page }: { page: Page }) => {
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
        const bar = (await page.getByTestId('top-bar').boundingBox())!
        const pageBox = (await page.getByTestId('task-management-page').boundingBox())!
        expect(pageBox.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      })
  })

  // KNOWN DEFECT, pinned (#650 follow-up). SPEC: a panel an app pins to the
  // window starts below the shared bar. The bar publishes its height as
  // --featherbase-bar-height; Tasker 2.3.0 still reads the retired runtime
  // shell's --featherbase-runtime-shell-inset (falling back to 0), so its phone
  // inspector opens under the bar. Tasker's files are not changed here: an
  // installed Tasker 2.3.0 is matched by fingerprint, and changed files under
  // the same version would stop the server booting. Fixed by a new Tasker
  // version that reads the bar's variable; then flip this to a plain test.
  test.fail("Tasker's inspector, pinned to the window, starts below the shared bar on a phone", async ({ session, request }) => {
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
        .clickLink('Host shell mobile proof')
        .step("the inspector is pinned at the bar's height, not at the window's top", async ({ page }: { page: Page }) => {
          // Measured from the styles, not from where things happen to be
          // drawn: whether the bar is in view depends on how far the page was
          // scrolled (Tasker's own styles make its body the scroll container,
          // so the sticky bar scrolls with the page), and the bar may cover
          // the Inspector button, so it is pressed without aiming.
          await expect(page.getByTestId('top-bar')).toHaveCount(1)
          const barHeight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--featherbase-bar-height').trim())
          expect(barHeight).toMatch(/^\d+px$/)
          await page.getByRole('button', { name: 'Inspector' }).dispatchEvent('click')
          await expect(page.locator('.tasker-inspector')).toBeVisible()
          expect(await page.locator('.tasker-inspector').evaluate((el) => getComputedStyle(el).top)).toBe(barHeight)
        })
    } finally {
      await deleteTask(request, headers, task.row_id)
    }
  })
})
