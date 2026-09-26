import { test, expect, ensureRuntimeApp } from './fixtures'

test.beforeAll(async ({ request }) => {
  await ensureRuntimeApp(request, 'tasker')
})

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
  await page.getByRole('textbox', { name: 'New project' }).fill('Warehouse review')
  await page.getByRole('textbox', { name: 'New project' }).press('Enter')
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

  const filterButton = page.locator('.tasker-filter-button')
  await filterButton.focus()
  await page.keyboard.press('Enter')
  const filterDialog = page.getByRole('dialog', { name: 'Filter tasks' })
  await expect(filterDialog).toBeVisible()
  await expect(filterDialog.getByRole('checkbox', { name: 'Not started' })).toBeFocused()
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Space')
  await page.screenshot({ path: '../../task-management-filter-open.png', fullPage: true })
  await page.keyboard.press('Escape')
  await expect(filterDialog).toHaveCount(0)
  await expect(filterButton).toBeFocused()
  await expect(page.getByRole('button', { name: 'Remove Not started filter' })).toBeVisible()
  const secondState = page.getByRole('button', { name: 'Remove In progress filter' })
  await secondState.focus()
  await page.keyboard.press('Enter')
  await expect(secondState).toHaveCount(0)
  await expect(page.locator('.tasker-match-count')).toHaveAttribute('aria-live', 'polite')
  await page.getByRole('button', { name: 'Save view' }).click()
  await page.getByRole('textbox', { name: 'View name' }).fill('Open warehouse work')
  await page.getByRole('button', { name: 'Save private view' }).click()
  await expect(page.getByRole('heading', { name: 'Open warehouse work' })).toBeVisible()
  await expect(page).toHaveURL(/#view=/)
  await page.screenshot({ path: '../../task-management-saved-view.png', fullPage: true })
  await page.screenshot({ path: '../../task-management-project.png', fullPage: true })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Open warehouse work' })).toBeVisible()
  await expect(page.getByText('Compare September closing stock')).toBeVisible()
  await page.getByRole('button', { name: /My Work/ }).click()
  await expect(page.getByText('Review September stock variance')).toBeVisible()
})

test.describe('phone capture', () => {
  test.use({ viewport: { width: 375, height: 720 } })

  test('responsive_workspace_flow: Tasker and its Projects landing have no page-level horizontal overflow', async ({ page }) => {
    await page.goto('/tasker/')
    await expect(page.getByRole('textbox', { name: 'Quick capture' })).toBeVisible()
    await page.getByRole('button', { name: 'Filter' }).click()
    const sheet = page.getByRole('dialog', { name: 'Filter tasks' })
    await expect(sheet).toBeVisible()
    const sheetBox = await sheet.boundingBox()
    expect(sheetBox).not.toBeNull()
    expect(sheetBox!.x).toBe(0)
    expect(sheetBox!.width).toBe(375)
    expect(Math.abs(sheetBox!.y + sheetBox!.height - 720)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: '../../task-management-filter-mobile.png' })
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await page.getByRole('button', { name: 'Projects' }).click()
    await expect(page.getByRole('textbox', { name: 'New project' })).toBeVisible()
    await page.screenshot({ path: '../../task-management-mobile.png', fullPage: true })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
  })
})
