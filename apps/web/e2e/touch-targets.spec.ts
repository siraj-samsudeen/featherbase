import { test, anonymousTest, expect, adminAuth, type Page } from './fixtures'
import { ensureListTableA, ensureTable, fillRows, LIST_DT_A } from './fixtures-ui'
import * as XLSX from 'xlsx'

// usable-on-any-device "Comfortable to tap on a phone" (#380 task 4.5): on a
// phone, every control on the main screens is big enough for a thumb. The
// check measures each control's tap area as the browser lays it out at
// 375px with a touch screen: its own box, grown by a label around it (a
// checkbox's label is its target) and by an absolutely placed ::before hit
// area (the recipes' way to enlarge a target without moving the layout).
//
// The bar is 44px each way. Two kinds of target are allowed below it, as
// WCAG 2.5.8 allows: a link inside a sentence, and a small glyph inside a
// chip, which keeps the recipe's 32px hit area so it cannot reach the next
// chip (touchTargetClasses).
const MIN = 44
const CHIP_GLYPH = 32

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
anonymousTest.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

// #738: a Table with more list columns than a phone card shows, so its cards
// carry "N more", and its Show columns menu has rows on both sides of the divider.
const WIDE_DT = 'UI Touch Wide'
const WIDE_COLUMNS = ['title', 'stage', 'owner', 'region', 'amount', 'notes', 'source']

test.beforeAll(async ({ request }) => {
  const auth = await adminAuth(request)
  await ensureListTableA(request, auth)
  await ensureTable(request, auth, {
    name: WIDE_DT,
    columns: WIDE_COLUMNS.map((c, i) => ({ column_name: c, column_type: 'Data', in_list_view: i < 6 })),
  })
  await fillRows(request, auth, WIDE_DT, 2, (i) => Object.fromEntries(WIDE_COLUMNS.map((c) => [c, `${c}-${i}`])))
})

/** Every visible control whose tap area is too small, described for the failure message. */
async function smallTargets(page: Page): Promise<string[]> {
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the page must see a touch screen').toBe(true)
  return page.evaluate(
    ({ MIN, CHIP_GLYPH }) => {
      const controls = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=menuitem], [role=tab]'
      const out: string[] = []
      for (const el of document.querySelectorAll<HTMLElement>(controls)) {
        const box = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        if (!box.width || !box.height || style.visibility === 'hidden' || el.closest('[aria-hidden="true"], [inert]')) continue
        // A link inside running text (WCAG 2.5.8's inline exception).
        if (el.tagName === 'A' && style.display === 'inline' && [...(el.parentElement?.childNodes ?? [])].some((n) => n.nodeType === 3 && /\S/.test(n.textContent ?? ''))) continue
        let w = box.width
        let h = box.height
        const label = el.closest('label')
        if (label) {
          const l = label.getBoundingClientRect()
          w = Math.max(w, l.width)
          h = Math.max(h, l.height)
        }
        const before = getComputedStyle(el, '::before')
        if (before.content !== 'none' && before.position === 'absolute') {
          w = Math.max(w, parseFloat(before.width) || 0)
          h = Math.max(h, parseFloat(before.height) || 0)
        }
        // A ::before hit area is the recipes' chip-glyph target (touchTargetClasses) or a whole row.
        const floor = before.content !== 'none' && before.position === 'absolute' ? CHIP_GLYPH : MIN
        if (w < floor - 0.5 || h < floor - 0.5) {
          const name = el.getAttribute('aria-label') ?? el.dataset.testid ?? (el.textContent ?? '').trim().slice(0, 30)
          out.push(`${el.tagName.toLowerCase()} "${name}" is ${Math.round(w)}×${Math.round(h)}`)
        }
      }
      return out
    },
    { MIN, CHIP_GLYPH },
  )
}

async function rowId(page: Page): Promise<string> {
  const res = await page.request.get(`/api/table/${encodeURIComponent(LIST_DT_A)}?limit_page_length=1`, {
    headers: await adminAuth(page.request),
  })
  return ((await res.json()) as { data: { row_id: string }[] }).data[0].row_id
}

const SCREENS: [string, (page: Page) => Promise<string>][] = [
  ['Admin home', async () => '/admin'],
  ['a Table list (cards)', async () => `/admin/${encodeURIComponent(LIST_DT_A)}`],
  ['a row', async (page) => `/admin/${encodeURIComponent(LIST_DT_A)}/${await rowId(page)}`],
  ['a new row', async () => `/admin/${encodeURIComponent(LIST_DT_A)}/new`],
  ['a report', async () => `/admin/${encodeURIComponent(LIST_DT_A)}/view/report`],
  ['System Settings', async () => '/admin/System%20Settings'],
  ['All tables', async () => '/admin/all-tables'],
  ['permissions', async () => `/admin/permissions/${encodeURIComponent(LIST_DT_A)}`],
  ['access tokens', async () => '/admin/access-tokens'],
  ['the new-Table builder', async () => '/admin/new-table'],
  ['the column editor', async () => `/admin/${encodeURIComponent(LIST_DT_A)}/columns`],
]

for (const [screen, path] of SCREENS) {
  test(`every control on ${screen} is big enough for a thumb`, async ({ session, page }) => {
    await session.visit(await path(page)).assertHas('main')
    await session.step(`measure every control on ${screen}`, async ({ page }) => {
      await page.waitForLoadState('networkidle')
      expect(await smallTargets(page)).toEqual([])
    })
  })
}

test('every row of the open menu and the Account menu is big enough for a thumb', async ({ session }) => {
  await session.visit('/admin').assertHas('main')
  await session.step('open the sidebar and the Account menu, then measure', async ({ page }) => {
    await page.getByTestId('session-user').click()
    await expect(page.getByTestId('account-menu')).toBeVisible()
    expect(await smallTargets(page)).toEqual([])
  })
})

anonymousTest('every control on the sign-in page is big enough for a thumb', async ({ session }) => {
  await session.visit('/featherbase/login').assertHas('[data-testid="login-form"]')
  await session.step('measure the sign-in page, then the forgotten-password form', async ({ page }) => {
    expect(await smallTargets(page)).toEqual([])
    await page.getByTestId('forgot-password').click()
    expect(await smallTargets(page)).toEqual([])
  })
})

test('every row of the Show columns menu is big enough for a thumb', async ({ session }) => {
  await session.visit(`/admin/${encodeURIComponent(WIDE_DT)}`).assertHas('[data-testid="list-view"]')
  await session.step('open Show columns, then measure', async ({ page }) => {
    await page.getByTestId('list-columns').click()
    await expect(page.getByTestId('list-make-default')).toBeVisible()
    expect(await smallTargets(page)).toEqual([])
  })
})

test('the "N more" toggle on a phone card is big enough for a thumb', async ({ session }) => {
  await session.visit(`/admin/${encodeURIComponent(WIDE_DT)}`).assertHas('[data-testid="card-more"]')
  await session.step('measure the cards, then open one card\'s other columns and measure again', async ({ page }) => {
    await page.waitForLoadState('networkidle')
    expect(await smallTargets(page)).toEqual([])
    await page.getByTestId('card-more').first().click()
    expect(await smallTargets(page)).toEqual([])
  })
})

test('every control on the Import Wizard\'s new-Table columns is big enough for a thumb', async ({ session }) => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Touch Ref', 'Touch Amount', 'Touch Note'],
    ['T-1', 1, 'a'],
    ['T-2', 2, 'b'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Touch Sheet')
  await session.visit('/admin/import').assertHas('[data-testid="import-wizard"]')
  await session.step('drop a one-sheet workbook, then measure the column grid', async ({ page }) => {
    await page.getByTestId('iw-file-input').setInputFiles({
      name: 'touch.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    })
    await expect(page.getByTestId('iw-list-all-0')).toBeVisible()
    const small = await smallTargets(page)
    expect(small.filter((s) => /Tick all|Clear the list/.test(s))).toEqual([])
  })
})

// #738: a phone-width screen without a touch screen (a narrowed desktop
// window, a phone emulator without touch) still draws the phone shapes, so
// their controls keep the thumb size there too.
test.describe('at phone width with a mouse', () => {
  test.use({ hasTouch: false, isMobile: false })

  async function heights(page: Page, selector: string): Promise<number[]> {
    return page.locator(selector).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
  }

  test('the "N more" toggle on a phone card is thumb-sized', async ({ session }) => {
    await session.visit(`/admin/${encodeURIComponent(WIDE_DT)}`).assertHas('[data-testid="card-more"]')
    await session.step('measure every "N more"', async ({ page }) => {
      for (const h of await heights(page, '[data-testid="card-more"]')) expect(h).toBeGreaterThanOrEqual(MIN)
    })
  })

  test('every row of the Show columns menu is thumb-sized', async ({ session }) => {
    await session.visit(`/admin/${encodeURIComponent(WIDE_DT)}`).assertHas('[data-testid="list-view"]')
    await session.step('open Show columns, then measure its rows', async ({ page }) => {
      await page.getByTestId('list-columns').click()
      const rows = await heights(page, '[data-testid="list-columns-popup"] :is(label, button)')
      expect(rows.length).toBeGreaterThan(WIDE_COLUMNS.length)
      for (const h of rows) expect(h).toBeGreaterThanOrEqual(MIN)
    })
  })
})
