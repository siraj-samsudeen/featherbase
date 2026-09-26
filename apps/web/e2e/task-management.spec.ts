import { test, expect, ensureRuntimeApp } from './fixtures'

test.beforeAll(async ({ request }) => {
  await ensureRuntimeApp(request, 'tasker')
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
test('tasker_browser_flow: PKG-J1 PKG-R4 capture, project entry, urgency, and focus survive reload', async ({
  session,
}) => {
  await session
    .visit('/tasker/')
    .fillIn('Quick capture', 'Review September stock variance')
    .pressKey('Enter')
    .assertText('Review September stock variance')

  await session.step('quick capture keeps focus after adding a task', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: 'Quick capture' })).toBeFocused()
  })

  await session
    .fillIn('Quick capture', 'Confirm warehouse count date')
    .pressKey('Enter')
    .assertText('Confirm warehouse count date')

  await session.step('new tasks retain their capture order', async ({ page }) => {
    await expect(page.locator('article').nth(0)).toContainText('Review September stock variance')
  })

  await session
    .within('button[aria-label="Mark urgent Confirm warehouse count date"]', (button) =>
      button.assertExactText('Not urgent'),
    )
    .clickButton('Mark urgent Confirm warehouse count date')
    .clickButton('Add to My Focus: Review September stock variance')
    .within('button[aria-label="Remove urgent flag from Confirm warehouse count date"]', (button) =>
      button.assertExactText('Urgent'),
    )
    .selectOption('State for Review September stock variance', 'Blocked')
    .fillIn(
      'Optional explanation',
      'Waiting for the warehouse team to confirm the closing count',
    )
    .clickButton('Save note')
    .assertText('Waiting for the warehouse team')

  await session.step('capture the configured task', async ({ page }) => {
    await page.screenshot({ path: '../../task-management.png', fullPage: true })
  })

  await session
    .clickButton('Projects')
    .fillIn('New project', 'Warehouse review')
    .pressKey('Enter')

  await session.step('creating a project transfers focus to its task input', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: 'Add task to project' })).toBeFocused()
  })

  await session
    .fillIn('Add task to project', 'Compare September closing stock')
    .pressKey('Enter')
    .assertText('Compare September closing stock')
    .within('article:has-text("Compare September closing stock")', (card) =>
      card
        .within('button[aria-label="Mark urgent Compare September closing stock"]', (button) =>
          button.assertExactText('Not urgent'),
        )
        .assertHas('button[aria-label="Add to My Focus: Compare September closing stock"]')
        .assertHas('button', { text: 'Take it', exact: true }),
    )
    .assertValue('Assign Compare September closing stock', '')

  await session.step('focus the filter button', async ({ page }) => {
    await page.locator('.tasker-filter-button').focus()
  })
  await session
    .pressKey('Enter')
    .assertHas('[role="dialog"][aria-label="Filter tasks"]')
  await session.step('the filter sheet starts on the first checkbox', async ({ page }) => {
    await expect(
      page.getByRole('dialog', { name: 'Filter tasks' }).getByRole('checkbox', { name: 'Not started' }),
    ).toBeFocused()
  })
  await session.pressKey('Space').pressKey('Tab').pressKey('Space')
  await session.step('capture the open filter sheet', async ({ page }) => {
    await page.screenshot({ path: '../../task-management-filter-open.png', fullPage: true })
  })
  await session
    .pressKey('Escape')
    .refuteHas('[role="dialog"][aria-label="Filter tasks"]')
  await session.step('closing the filter sheet restores focus to its trigger', async ({ page }) => {
    await expect(page.locator('.tasker-filter-button')).toBeFocused()
  })
  await session.assertHas('button[aria-label="Remove Not started filter"]')
  await session.step('focus the second active filter', async ({ page }) => {
    await page.getByRole('button', { name: 'Remove In progress filter' }).focus()
  })
  await session
    .pressKey('Enter')
    .refuteHas('button[aria-label="Remove In progress filter"]')
    .within('.tasker-match-count', (count) => count.assertAttribute('aria-live', 'polite'))
    .clickButton('Save view')
    .fillIn('View name', 'Open warehouse work')
    .clickButton('Save private view')
    .within('#views-heading', (heading) => heading.assertExactText('Open warehouse work'))
  await session.step('the saved view is reflected in the URL', async ({ page }) => {
    await expect(page).toHaveURL(/#view=/)
  })
  await session.step('capture the saved project view', async ({ page }) => {
    await page.screenshot({ path: '../../task-management-saved-view.png', fullPage: true })
    await page.screenshot({ path: '../../task-management-project.png', fullPage: true })
  })

  await session
    .reload()
    .within('#views-heading', (heading) => heading.assertExactText('Open warehouse work'))
    .assertText('Compare September closing stock')
    .within('.tasker-nav-work', (tab) => tab.click('My Work'))
    .assertText('Review September stock variance')
})

test('tasker_focus_label: Focus identifies the star in both states without changing its accessible name', async ({
  session,
}) => {
  await session
    .visit('/tasker/')
    .fillIn('Quick capture', 'Plan the weekly review')
    .pressKey('Enter')
    .assertHas('button.tasker-focus-star[aria-label="Add to My Focus: Plan the weekly review"]', { text: '☆ Focus' })
    .clickButton('Add to My Focus: Plan the weekly review')
    .assertHas('button.tasker-focus-star.is-focused[aria-label="Remove from My Focus: Plan the weekly review"]', { text: '★ Focus' })
    .clickButton('Remove from My Focus: Plan the weekly review')
    .assertHas('button.tasker-focus-star[aria-label="Add to My Focus: Plan the weekly review"]', { text: '☆ Focus' })
})

test.describe('phone capture', () => {
  test.use({ viewport: { width: 375, height: 720 } })

  test('responsive_workspace_flow: Tasker and its Projects landing have no page-level horizontal overflow', async ({ session }) => {
    await session.visit('/tasker/')
    await session
      .assertValue('Quick capture', '')
      .clickButton('Filter')
    await session.step('the filter sheet fills the bottom of the mobile viewport', async ({ page }) => {
      const sheet = page.getByRole('dialog', { name: 'Filter tasks' })
      const sheetBox = await sheet.boundingBox()
      expect(sheetBox).not.toBeNull()
      expect(sheetBox!.x).toBe(0)
      expect(sheetBox!.width).toBe(375)
      expect(Math.abs(sheetBox!.y + sheetBox!.height - 720)).toBeLessThanOrEqual(1)
      await page.screenshot({ path: '../../task-management-filter-mobile.png' })
    })
    await session
      .pressKey('Escape')
      .refuteHas('[role="dialog"][aria-label="Filter tasks"]')
      .clickButton('Projects')
      .assertValue('New project', '')
    await session.step('capture the mobile Projects landing', async ({ page }) => {
      await page.screenshot({ path: '../../task-management-mobile.png', fullPage: true })
    })
    await session.assertNoHorizontalOverflow()
  })
})
