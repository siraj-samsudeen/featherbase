import { test, expect, adminAuth, type Page } from './fixtures'

const DT = 'Resp E2E Item'

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'qty', column_type: 'Int', in_list_view: true },
        { column_name: 'notes', column_type: 'Text' },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { title: 'Widget', qty: 5 } })
})

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
}

async function expectVisibleFocusOutsideSidebar(page: Page): Promise<void> {
  const focused = page.locator(':focus')
  await expect(focused).toBeInViewport()
  expect(
    await focused.evaluate((element) => element.closest('[data-testid="admin-sidebar"]') === null),
  ).toBe(true)
}

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md):
// supported keyboard and link actions use Session verbs. Focus setup,
// responsive measurements and focus-state assertions stay in named steps.
test.describe('UI-025: responsive Admin (mobile)', () => {
  test.use({ viewport: { width: 375, height: 720 } })

  test('sidebar collapses to a drawer and list/form are usable at mobile width', async ({ session }) => {
    await session.visit('/admin')
    await session.step('the closed phone drawer is off-screen and inert', async ({ page }) => {
      // The hamburger is shown; the sidebar starts off-screen (translated left).
      await expect(page.getByTestId('sidebar-toggle')).toBeVisible()
      const closedBox = await page.getByTestId('admin-sidebar').boundingBox()
      expect(closedBox).not.toBeNull()
      expect(closedBox!.x).toBeLessThan(0) // off-screen to the left
      await expect(page.getByTestId('admin-sidebar')).toHaveAttribute('inert', '')
      await expect(page.getByTestId('admin-sidebar')).toHaveAttribute('aria-hidden', 'true')

      // The account control is the last focusable header item. Tabbing past
      // it must skip every link in the closed, off-screen drawer and land on
      // a control the user can actually see.
      await page.getByTestId('session-user').focus()
    })
    await session.pressKey('Tab')
    await session.step('focus skips every descendant of the closed drawer', async ({ page }) => {
      await expectVisibleFocusOutsideSidebar(page)
    })

    // Keyboard-opening the drawer brings it on-screen and restores its
    // links to the tab order (wait out the transition).
    await session.step('focus the drawer toggle', async ({ page }) => {
      await page.getByTestId('sidebar-toggle').focus()
    })
    await session.pressKey('Enter')
    await session.step('the drawer finishes opening and becomes available', async ({ page }) => {
      await expect(page.getByTestId('sidebar-backdrop')).toBeVisible()
      await expect
        .poll(async () => (await page.getByTestId('admin-sidebar').boundingBox())!.x)
        .toBeGreaterThanOrEqual(0)
      await expect(page.getByTestId('admin-sidebar')).not.toHaveAttribute('inert')
      await expect(page.getByTestId('admin-sidebar')).not.toHaveAttribute('aria-hidden')
      await page.getByTestId('session-user').focus()
    })
    await session.pressKey('Tab')
    await session.step('focus enters the open drawer', async ({ page }) => {
      await expect(page.getByTestId('new-table-link')).toBeFocused()
    })

    // Keyboard-closing it removes those links again once the slide-out
    // transition completes.
    await session.step('focus the drawer toggle again', async ({ page }) => {
      await page.getByTestId('sidebar-toggle').focus()
    })
    await session.pressKey('Enter')
    await session.step('the drawer finishes closing and becomes inert', async ({ page }) => {
      await expect(page.getByTestId('sidebar-backdrop')).toHaveCount(0)
      await expect
        .poll(async () => (await page.getByTestId('admin-sidebar').boundingBox())!.x)
        .toBeLessThan(0)
      await expect(page.getByTestId('admin-sidebar')).toHaveAttribute('inert', '')
      await page.getByTestId('session-user').focus()
    })
    await session.pressKey('Tab')
    await session.step('focus again skips every descendant of the closed drawer', async ({ page }) => {
      await expectVisibleFocusOutsideSidebar(page)
    })

    // Reopen the drawer for its navigation journey below.
    await session.step('focus the drawer toggle for navigation', async ({ page }) => {
      await page.getByTestId('sidebar-toggle').focus()
    })
    await session.pressKey('Enter')
    await session.step('the drawer finishes reopening', async ({ page }) => {
      await expect
        .poll(async () => (await page.getByTestId('admin-sidebar').boundingBox())!.x)
        .toBeGreaterThanOrEqual(0)
    })

    // Navigating from the drawer closes it (#80: the drawer lists Home
    // Pages + All tables; the table link is then on the All tables page).
    await session
      .clickLink('All tables')
      .assertPath('/featherbase/admin/all-tables')
      .clickLink(DT)
      .assertHas('[data-testid="list-view"]')
    await session.step('the table list fits after drawer navigation', async ({ page }) => {
      await expect(page).toHaveURL(new RegExp(`/admin/${encodeURIComponent(DT)}`))
      await expect(page.getByTestId('sidebar-backdrop')).toHaveCount(0)
      await expect
        .poll(async () => (await page.getByTestId('admin-sidebar').boundingBox())!.x)
        .toBeLessThan(0)

      // The list view does not force the page to scroll horizontally.
      expect(await noHorizontalOverflow(page)).toBe(true)
    })

    await session.clickLink('New').assertHas('[data-testid="form-view"]')
    await session.step('the phone form stacks fields without page overflow', async ({ page }) => {
      const f1 = await page.locator('[data-field=title]').boundingBox()
      const f2 = await page.locator('[data-field=qty]').boundingBox()
      expect(f1).not.toBeNull()
      expect(f2).not.toBeNull()
      expect(f2!.y).toBeGreaterThan(f1!.y + 10) // stacked, not side-by-side
      expect(await noHorizontalOverflow(page)).toBe(true)
    })

    // The media listener and Tailwind's md: breakpoint must switch on the
    // same pixel while this mounted layout remains closed.
    await session.step('resize the mounted layout from 767 to 768 pixels', async ({ page }) => {
      await page.setViewportSize({ width: 767, height: 720 })
      await expect(page.getByTestId('admin-sidebar')).toHaveAttribute('inert', '')
      await page.setViewportSize({ width: 768, height: 720 })
      await expect(page.getByTestId('sidebar-toggle')).toBeHidden()
      await expect(page.getByTestId('admin-sidebar')).not.toHaveAttribute('inert')
      await expect(page.getByTestId('admin-sidebar')).not.toHaveAttribute('aria-hidden')
      await page.getByTestId('session-user').focus()
    })
    await session.pressKey('Tab')
    await session.step('the 768-pixel desktop sidebar is in the tab order', async ({ page }) => {
      await expect(page.getByTestId('new-table-link')).toBeFocused()
    })
    await session.step('resize the same layout back below the breakpoint', async ({ page }) => {
      await page.setViewportSize({ width: 767, height: 720 })
      await expect(page.getByTestId('sidebar-toggle')).toBeVisible()
      await expect(page.getByTestId('admin-sidebar')).toHaveAttribute('inert', '')
      await expect(page.getByTestId('admin-sidebar')).toHaveAttribute('aria-hidden', 'true')
      await page.getByTestId('session-user').focus()
    })
    await session.pressKey('Tab')
    await session.step('the 767-pixel closed drawer leaves the tab order', async ({ page }) => {
      await expectVisibleFocusOutsideSidebar(page)
    })
  })
})

test.describe('UI-025: desktop keeps a static sidebar', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('sidebar is always visible and the hamburger is hidden', async ({ session }) => {
    await session.visit('/admin')
    await session.step('the drawer toggle is hidden and the sidebar is on-screen', async ({ page }) => {
      await expect(page.getByTestId('sidebar-toggle')).toBeHidden()
      const box = await page.getByTestId('admin-sidebar').boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      await expect(page.getByTestId('admin-sidebar')).not.toHaveAttribute('inert')
      await expect(page.getByTestId('admin-sidebar')).not.toHaveAttribute('aria-hidden')

      // The static desktop sidebar remains in the tab order even though the
      // mobile drawer state starts closed.
      await page.getByTestId('session-user').focus()
    })
    await session.pressKey('Tab')
    await session.step('focus enters the static desktop sidebar', async ({ page }) => {
      await expect(page.getByTestId('new-table-link')).toBeFocused()
    })
  })
})
