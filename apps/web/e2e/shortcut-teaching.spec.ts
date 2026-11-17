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
      const [control, mark] = await Promise.all([page.locator('[data-shortcut-id="sidebar"]').boundingBox(), badge.boundingBox()])
      // The badge sits on the top-right corner of the control that carries the key.
      expect(Math.abs(mark!.x + mark!.width - (control!.x + control!.width - 5))).toBeLessThanOrEqual(2)
      expect(Math.abs(mark!.y - (control!.y - 7))).toBeLessThanOrEqual(2)
    })
})
