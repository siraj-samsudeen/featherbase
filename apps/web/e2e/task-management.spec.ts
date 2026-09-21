import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

async function ensureTaskManagement(request: APIRequestContext) {
  const headers = await adminAuth(request)
  const meta = await request.get('/api/table/tasker.task:meta', { headers })
  if (meta.ok()) return
  const installed = await request.post('/api/install_app', {
    headers,
    data: { name: 'tasker' },
  })
  if (installed.status() !== 201)
    throw new Error(`install tasker: ${installed.status()} ${await installed.text()}`)
}

test.beforeAll(async ({ request }) => {
  await ensureTaskManagement(request)
})

// @spec capture_neutral_task.entry_stays_ready
test('tasker_browser_flow: PKG-J1 PKG-R4 capture, project entry, urgency, and focus survive reload', async ({
  page,
}) => {
  await page.goto('/tasker/')
  const capture = page.getByRole('textbox', { name: 'Quick capture' })
  await capture.fill('Review September stock variance')
  await capture.press('Enter')
  await expect(page.getByText('Review September stock variance')).toBeVisible()
  await expect(capture).toBeFocused()
  await capture.fill('Confirm warehouse count date')
  await capture.press('Enter')
  await expect(page.getByText('Confirm warehouse count date')).toBeVisible()

  const taskCards = page.locator('article')
  await expect(taskCards.nth(0)).toContainText('Review September stock variance')
  const urgentToggle = page.getByRole('button', {
    name: 'Mark urgent Confirm warehouse count date',
  })
  await expect(urgentToggle).toHaveText('Not urgent')
  await urgentToggle.click()
  await expect(taskCards.nth(0)).toContainText('Review September stock variance')
  await page.getByRole('button', {
    name: 'Add to My Focus: Review September stock variance',
  }).click()
  await expect(page.getByRole('button', {
    name: 'Remove urgent flag from Confirm warehouse count date',
  })).toHaveText('Urgent')
  await page.getByRole('combobox', {
    name: 'State for Review September stock variance',
  }).selectOption('Blocked')
  await page.getByRole('textbox', { name: 'Optional explanation' }).fill(
    'Waiting for the warehouse team to confirm the closing count',
  )
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(page.getByText(/Waiting for the warehouse team/)).toBeVisible()
  await page.screenshot({ path: '../../task-management.png', fullPage: true })

  await page.getByRole('button', { name: 'Projects' }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('Warehouse review')
  await page.getByRole('textbox', { name: 'Project name' }).press('Enter')
  const projectTask = page.getByRole('textbox', { name: 'Add task to project' })
  await expect(projectTask).toBeFocused()
  await projectTask.fill('Compare September closing stock')
  await projectTask.press('Enter')
  await expect(page.getByText('Compare September closing stock')).toBeVisible()
  const projectCard = page.locator('article').filter({
    hasText: 'Compare September closing stock',
  })
  await expect(projectCard.getByRole('button', {
    name: 'Mark urgent Compare September closing stock',
  })).toHaveText('Not urgent')
  await expect(projectCard.getByRole('button', {
    name: 'Add to My Focus: Compare September closing stock',
  })).toBeVisible()
  await expect(projectCard.getByRole('button', { name: 'Take it' })).toBeVisible()
  await expect(page.getByRole('combobox', {
    name: 'Assign Compare September closing stock',
  })).toHaveValue('')
  await page.screenshot({ path: '../../task-management-project.png', fullPage: true })

  await page.reload()
  await page.getByRole('button', { name: /My Work/ }).click()
  await expect(page.getByText('Review September stock variance')).toBeVisible()
})

test.describe('phone capture', () => {
  test.use({ viewport: { width: 375, height: 720 } })

  // @spec workspace_adapts_to_available_space.mobile_projects_landing
  test('responsive_workspace_flow: Tasker and its Projects landing have no page-level horizontal overflow', async ({ page }) => {
    await page.goto('/tasker/')
    await expect(page.getByRole('textbox', { name: 'Quick capture' })).toBeVisible()
    await page.getByRole('button', { name: 'Projects' }).click()
    await expect(page.getByRole('textbox', { name: 'New project' })).toBeVisible()
    await page.screenshot({ path: '../../task-management-mobile.png', fullPage: true })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
  })
})
