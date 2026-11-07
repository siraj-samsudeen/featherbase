import { tableSlug } from 'shared'
import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Arrange Layout DT'
const LONG = 'Arrange Long DT'

// #1012: choosing a column count moves nothing but the form below the toolbar.
// Only a browser lays the toolbar out.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const row = await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { row_id: 'layout-1', title: 'layout row' } })
  if (![201, 409].includes(row.status())) throw new Error(`row: ${row.status()}`)
  const long = await request.post('/api/table_def', {
    headers,
    data: { name: LONG, id_pattern: 'prompt', columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'code', column_type: 'Data' },
      { column_name: 'notes', column_type: 'Long Text' },
    ] },
  })
  if (![201, 409].includes(long.status())) throw new Error(`long table: ${long.status()}`)
  const longRow = await request.post(`/api/table/${encodeURIComponent(LONG)}`, { headers, data: { row_id: 'long-1', title: 'a', code: 'b', notes: 'c' } })
  if (![201, 409].includes(longRow.status())) throw new Error(`long row: ${longRow.status()}`)
})

test('#1012: the arrange controls stay put whichever column count is chosen', async ({ session, page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/layout-1`)
  // The widest system fonts decide whether the bar fits, so test with one on every machine.
  await page.addStyleTag({ content: "body, button { font-family: Verdana, 'DejaVu Sans' !important; }" })
  const one = page.getByTestId('arrange-columns-1')
  const two = page.getByTestId('arrange-columns-2')
  await expect(two).toBeVisible()

  await session.step('every control keeps its place, and the fields alone narrow', async () => {
    await two.click()
    await expect(two).toHaveAttribute('aria-pressed', 'true')
    const before = { one: await one.boundingBox(), two: await two.boundingBox(), first: await page.getByTestId('arrange-importance').boundingBox() }
    const wide = (await page.getByTestId('form-fields').boundingBox())!.width
    await one.click()
    await expect(one).toHaveAttribute('aria-pressed', 'true')
    expect({ one: await one.boundingBox(), two: await two.boundingBox(), first: await page.getByTestId('arrange-importance').boundingBox() }).toEqual(before)
    expect((await page.getByTestId('form-fields').boundingBox())!.width).toBeLessThan(wide)
    // All on one line, at a desktop width.
    expect(before.first!.y).toBeCloseTo(before.one!.y, 0)
  })
})

// A wide field spans two columns; in one column that must not conjure a second.
test('#1012: choosing one column puts every field on its own line, with a wide field present', async ({ session, page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(LONG))}/row/long-1`)
  const one = page.getByTestId('arrange-columns-1')
  await expect(one).toBeVisible()
  await one.click()
  await expect(one).toHaveAttribute('aria-pressed', 'true')
  await session.step('the fields stack, each as wide as the others', async () => {
    const title = (await page.getByLabel('Title', { exact: true }).boundingBox())!
    const code = (await page.getByLabel('Code', { exact: true }).boundingBox())!
    expect(code.x).toBeCloseTo(title.x, 0)
    expect(code.y).toBeGreaterThan(title.y)
    expect(code.width).toBeCloseTo(title.width, 0)
  })
})
