import { test, expect, adminAuth, type Page } from './fixtures'

// usable-on-any-device, "Use a screen without a mouse": moving through a
// screen with the keyboard alone reaches every control, and the control
// focus is on can always be seen. A real browser is the only witness: what
// is "visible focus" is the computed :focus-visible style from the real
// stylesheet, and Tab order is the browser's own.
//
// The representative screens are a Table's list and one of its rows' forms.
// Steps that walk the Tab order and read computed styles have no DSL verb,
// so they stay in named steps.

const DT = 'Kbn E2E Item'
let rowName: string

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      title_column: 'title',
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'aisle', column_type: 'Choice', choices: 'North\nSouth', in_list_view: true },
        { column_name: 'qty', column_type: 'Int', in_list_view: true },
        { column_name: 'in_stock', column_type: 'Check' },
        { column_name: 'notes', column_type: 'Text' },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const row = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers,
    data: { title: 'Kbn shelf label', aisle: 'North', qty: 3 },
  })
  rowName = ((await row.json()) as { row_id: string }).row_id
})

interface Walk {
  /** Controls inside the screen that Tab never reached. */
  unreached: string[]
  /** Tab stops inside the screen with no visible focus indicator. */
  unseen: string[]
  /** How many controls the screen holds — the walk is only as good as this. */
  controls: number
}

/** Tab from the top of the page until focus comes round again, and compare
 *  the stops inside `scope` with every enabled, visible control in it. */
async function tabThrough(page: Page, scope: string): Promise<Walk> {
  const total = await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) throw new Error(`no ${sel}`)
    const focusable =
      'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]'
    let n = 0
    for (const el of root.querySelectorAll<HTMLElement>(focusable)) {
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      const hidden =
        (el as HTMLInputElement).disabled ||
        el.tabIndex < 0 ||
        el.closest('[inert]') ||
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        (box.width === 0 && box.height === 0)
      if (hidden) continue
      el.dataset.kbnControl = String(n++)
    }
    return n
  }, scope)
  expect(total).toBeGreaterThan(0)

  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.scrollTo(0, 0)
  })
  const reached = new Set<string>()
  const unseen: string[] = []
  let first: string | null = null
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate((sel) => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      if (!el.dataset.kbnStop) el.dataset.kbnStop = String(Math.random())
      const inside = Boolean(el.closest(sel))
      const style = getComputedStyle(el)
      const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
      const ringed = style.boxShadow !== 'none' && style.boxShadow !== ''
      const name =
        el.getAttribute('aria-label') ||
        el.getAttribute('data-testid') ||
        el.getAttribute('data-field') ||
        (el.textContent ?? '').trim().slice(0, 40) ||
        el.tagName.toLowerCase()
      return { id: el.dataset.kbnStop, control: el.dataset.kbnControl ?? null, inside, visible: outlined || ringed, name: `${el.tagName.toLowerCase()} "${name}"` }
    }, scope)
    if (!stop) continue
    if (stop.id === first) break
    first ??= stop.id
    if (stop.control !== null) reached.add(stop.control)
    if (stop.inside && !stop.visible) unseen.push(stop.name)
  }
  const unreached = await page.evaluate(
    ({ sel, seen }) =>
      [...document.querySelectorAll<HTMLElement>(`${sel} [data-kbn-control]`)]
        .filter((el) => !seen.includes(el.dataset.kbnControl!))
        .map((el) => `${el.tagName.toLowerCase()} "${el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.getAttribute('data-field') || (el.textContent ?? '').trim().slice(0, 40)}"`),
    { sel: scope, seen: [...reached] },
  )
  return { unreached, unseen, controls: total }
}

/** Press Tab until `target` has focus; fail if it never does. */
async function tabTo(page: Page, target: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, target)) return
  }
  throw new Error(`Tab never reached ${target}`)
}

test.describe('usable-on-any-device: Use a screen without a mouse', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('a Table list: Tab reaches every control, each shows where focus is, and Enter opens a row', async ({ session }) => {
    await session.visit(`/admin/${encodeURIComponent(DT)}`).assertHas('[data-testid="list-view"]')
    await session.step('every control in the list is reached by Tab, with visible focus', async ({ page }) => {
      await expect(page.getByText('Kbn shelf label')).toBeVisible()
      const walk = await tabThrough(page, '[data-testid="list-view"]')
      expect(walk.controls).toBeGreaterThanOrEqual(5)
      expect(walk.unreached).toEqual([])
      expect(walk.unseen).toEqual([])
    })
    await session.step('the row is opened from the keyboard', async ({ page }) => {
      await tabTo(page, `[data-testid="list-view"] a[href$="/${rowName}"]`)
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('form-view')).toBeVisible()
    })
  })

  test('a row form: Tab reaches every control, each shows where focus is, and the row is edited and saved by keyboard', async ({ session }) => {
    await session.visit(`/admin/${encodeURIComponent(DT)}/${rowName}`).assertHas('[data-testid="form-view"]')
    await session.step('every control in the form is reached by Tab, with visible focus', async ({ page }) => {
      await expect(page.locator('[data-field=title]')).toHaveValue('Kbn shelf label')
      const walk = await tabThrough(page, '[data-testid="form-view"]')
      expect(walk.controls).toBeGreaterThanOrEqual(5)
      expect(walk.unreached).toEqual([])
      expect(walk.unseen).toEqual([])
    })
    await session.step('a field is changed and saved without the mouse', async ({ page }) => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await tabTo(page, '[data-field=qty]')
      await page.keyboard.press('Control+a')
      await page.keyboard.type('7')
      await tabTo(page, '[data-testid="form-save"]')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('form-banner')).toContainText('Saved')
    })
  })
})
