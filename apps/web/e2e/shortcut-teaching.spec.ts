import { test, expect, adminAuth, type Page } from './fixtures'

// #1251: what only a real layout can witness. A shortcut tip lands below the
// top bar without covering any control (the page's header buttons included),
// and the Keyboard Shortcuts panel and its key badges are fully on screen.

test.use({ viewport: { width: 1280, height: 800 } })

/** Controls the box covers, and whether the box leaves the window. */
async function coverage(page: Page, testId: string) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`)!
    const box = el.getBoundingClientRect()
    const covered = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role=tab]')]
      .filter((c) => !el.contains(c))
      .filter((c) => {
        const r = c.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.left < box.right && box.left < r.right && r.top < box.bottom && box.top < r.bottom
      })
      .map((c) => c.getAttribute('aria-label') || c.textContent?.trim() || c.tagName)
    const inside = box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight
    return { covered, inside }
  }, testId)
}

test('the first tip covers no control and stays on screen', async ({ session, request }) => {
  // Start as someone who has never used the sidebar's key.
  const headers = await adminAuth(request)
  const reset = await request.put('/api/user_settings/__shortcuts', { headers, data: { use: {}, quietUntil: 0, quiets: 0, lastTip: 0 } })
  expect(reset.ok()).toBe(true)

  await session
    .visit('/featherbase/admin/table/Person')
    .step('collapse and expand the sidebar with the mouse three times', async ({ page }) => {
      const control = page.getByTestId('sidebar-collapse')
      for (let i = 0; i < 3; i++) await control.click()
    })
    .step('the tip names the key, covers no control and is fully visible', async ({ page }) => {
      const tip = page.getByRole('status', { name: 'Tip' })
      await expect(tip).toContainText(/Press (⌘B|Ctrl\+B) to collapse or expand the sidebar\./)
      expect(await coverage(page, 'shortcut-tip')).toEqual({ covered: [], inside: true })
    })
    .step('? opens the Keyboard Shortcuts panel on screen, with a key badge on the sidebar control', async ({ page }) => {
      await page.keyboard.press('Shift+Slash')
      await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible()
      expect((await coverage(page, 'shortcuts-panel')).inside).toBe(true)
      const badge = page.getByTestId('shortcut-badge-sidebar')
      await expect(badge).toBeVisible()
      // The badge settles on the top-right corner of the control that carries
      // the key, once the sidebar has finished animating to its rail.
      await expect.poll(async () => {
        const [control, mark] = await Promise.all([page.locator('[data-shortcut-id="sidebar"]').boundingBox(), badge.boundingBox()])
        return Math.max(Math.abs(mark!.x + mark!.width - (control!.x + control!.width - 5)), Math.abs(mark!.y - (control!.y - 7)))
      }).toBeLessThanOrEqual(2)
    })
})

// Two widths, two layouts of the header: the reminder must cover no control
// and sit above the table either way (CI's Linux fonts are wider than a
// Mac's; the placement measures the real controls, not a fixed width).
for (const width of [1280, 1180]) test.describe(`at ${width}px`, () => {
test.use({ viewport: { width, height: 800 } })
test('a reminder with the sidebar expanded still fits near the top, covering no control', async ({ session, request }) => {
  // Used the key two days ago, then the mouse once: two more mouse uses bring
  // the reminder, and leave the sidebar expanded (the narrower content area).
  const headers = await adminAuth(request)
  const seeded = await request.put('/api/user_settings/__shortcuts', {
    headers,
    data: { use: { sidebar: { keys: 1, mouse: 1, shown: 0, lastKey: Date.now() - 2 * 86_400_000 } }, quietUntil: 0, quiets: 0, lastTip: 0 },
  })
  expect(seeded.ok()).toBe(true)

  await session
    .visit('/featherbase/admin/table/Person')
    .step('collapse and expand the sidebar with the mouse', async ({ page }) => {
      const control = page.getByTestId('sidebar-collapse')
      await control.click()
      await control.click()
    })
    .step('the reminder sits near the top of the page, covering no control', async ({ page }) => {
      const reminder = page.getByRole('status', { name: 'Reminder' })
      await expect(reminder).toContainText(/You've done this by mouse 3 times since you last used (⌘B|Ctrl\+B)\./)
      await expect.poll(() => coverage(page, 'shortcut-tip')).toEqual({ covered: [], inside: true })
      // Near the top whatever the fonts: above the table's first row, in the
      // page's header (CI's wider fonts leave no room beside the title, so
      // there it sits under the toolbar).
      const box = await reminder.boundingBox()
      const firstRow = await page.locator('tbody tr').first().boundingBox()
      expect(box!.y).toBeLessThan(firstRow!.y)
    })
})
})
