import { tableSlug } from 'shared'
import { test, expect, adminAuth, type Page } from './fixtures'
import { ensureListTableA, LIST_DT_A as DT_A } from './fixtures-ui'

// A form opened from the list steps to the previous and next record of that
// same list: its filters, its sort and its pages. The checks read the list's
// own order rather than assuming one, so a sort another spec saved for this
// user does not change what they prove.

const listUrl = (filters?: unknown[]) =>
  `/featherbase/admin/table/${encodeURIComponent(tableSlug(DT_A))}` +
  (filters ? `?filters=${encodeURIComponent(JSON.stringify(filters))}` : '')

const ROW_LINK = 'a[href*="/row/"]'

/** The address of each record the list shows, in its order. */
async function listedRecords(page: Page): Promise<string[]> {
  const rows = page.locator('[data-testid="list-rows"] tr')
  await expect(rows.first()).toBeVisible()
  return rows.evaluateAll((trs, sel) => trs.map((tr) => new URL((tr.querySelector(sel) as HTMLAnchorElement).href).pathname), ROW_LINK)
}

/** The form shows the record at this address. */
const formTitle = async (page: Page, path: string) => {
  await expect(page).toHaveURL((url) => url.pathname === path)
  await expect(page.getByTestId('form-view')).toBeVisible()
}

test.beforeAll(async ({ request }) => {
  await ensureListTableA(request, await adminAuth(request))
})

test('record nav: Previous and Next follow the filtered list the record was opened from', async ({ session }) => {
  // title like item-0% -> item-00 … item-09: ten rows, one page.
  await session.visit(listUrl([['title', 'like', 'item-0%']])).assertHas('[data-testid="list-rows"] tr', { count: 10 })

  await session.step('open the second row, then step forward and back', async ({ page }) => {
    const titles = await listedRecords(page)
    await page.locator('[data-testid="list-rows"] tr').nth(1).locator(ROW_LINK).first().click()
    await formTitle(page, titles[1])
    await expect(page.getByTestId('record-position')).toHaveText('2 of 10')

    await page.getByRole('button', { name: 'Next record' }).click()
    await formTitle(page, titles[2])
    await expect(page.getByTestId('record-position')).toHaveText('3 of 10')

    await page.getByRole('button', { name: 'Previous record' }).click()
    await page.getByRole('button', { name: 'Previous record' }).click()
    await formTitle(page, titles[0])
    await expect(page.getByTestId('record-position')).toHaveText('1 of 10')
    await expect(page.getByRole('button', { name: 'Previous record' })).toBeDisabled()
  })
})

test('record nav: steps across a page boundary of the list', async ({ session }) => {
  await session.visit(listUrl()).assertHas('[data-testid="list-rows"] tr', { count: 20 })

  await session.step('from the first row of page 2, Previous reaches the last row of page 1', async ({ page }) => {
    const firstPage = await listedRecords(page)
    await page.getByTestId('next-page').click()
    await expect(page.getByTestId('page-info')).toContainText('21')
    const secondPage = await listedRecords(page)
    await page.locator('[data-testid="list-rows"] tr').first().locator(ROW_LINK).first().click()
    await formTitle(page, secondPage[0])
    await expect(page.getByTestId('record-position')).toHaveText('21 of 30')

    await page.getByRole('button', { name: 'Previous record' }).click()
    await formTitle(page, firstPage[19])
    await expect(page.getByTestId('record-position')).toHaveText('20 of 30')
  })
})

test('record nav: a record opened without its list shows no record nav', async ({ session }) => {
  await session.visit(listUrl()).assertHas('[data-testid="list-rows"] tr', { count: 20 })
  await session.step('open a row by its address in a fresh tab', async ({ page }) => {
    const href = await page.locator('[data-testid="list-rows"] tr').first().locator(ROW_LINK).first().getAttribute('href')
    const fresh = await page.context().newPage()
    await fresh.goto(href!)
    await expect(fresh.locator('[data-testid="form-view"]')).toBeVisible()
    await expect(fresh.getByTestId('record-nav')).toHaveCount(0)
    await fresh.close()
  })
})

test('record nav: unsaved changes are kept unless the user agrees to leave', async ({ session }) => {
  await session.visit(listUrl([['title', 'like', 'item-0%']])).assertHas('[data-testid="list-rows"] tr', { count: 10 })

  await session.step('decline, then accept, the leave question', async ({ page }) => {
    const titles = await listedRecords(page)
    await page.locator('[data-testid="list-rows"] tr').first().locator(ROW_LINK).first().click()
    await formTitle(page, titles[0])
    const title = page.locator('[data-field=title]')
    await expect(title).not.toHaveValue('')
    await title.fill('edited, not saved')

    // The form's own leave question, asked once (#1009), not a browser prompt as well.
    const leave = page.getByTestId('unsaved-leave-dialog')
    await page.getByRole('button', { name: 'Next record' }).click()
    await leave.getByRole('button', { name: 'Stay' }).click()
    await expect(leave).toHaveCount(0)
    await expect(page.locator('[data-field=title]')).toHaveValue('edited, not saved')

    await page.getByRole('button', { name: 'Next record' }).click()
    await leave.getByRole('button', { name: 'Leave without saving' }).click()
    await formTitle(page, titles[1])
  })
})
