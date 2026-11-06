import { tableSlug } from 'shared'
import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Arrange Layout DT'

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
})

test('#1012: the arrange controls stay put whichever column count is chosen', async ({ session, page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/layout-1`)
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
