import { tableSlug } from 'shared'
import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Unsaved Long DT'

// #1009: only a browser can say the Save bar is really on screen after a
// scroll, and only a real page fires the browser's own leave warning.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const headers = await adminAuth(request)
  const columns = Array.from({ length: 30 }, (_, i) => ({ column_name: `field_${i}`, column_type: 'Data' }))
  const dt = await request.post('/api/table_def', { headers, data: { name: DT, id_pattern: 'prompt', columns } })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const row = await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { row_id: 'long-1', field_0: 'a', field_29: 'b' } })
  if (![201, 409].includes(row.status())) throw new Error(`row: ${row.status()}`)
})

test('#1009: Save stays on screen after scrolling, and reloading warns', async ({ session, page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/long-1`)
  const field = page.getByLabel('Field 0', { exact: true })
  await expect(field).toBeVisible()

  await session.step('a change high on the page keeps Save in view at any scroll', async () => {
    await field.fill('changed')
    const bar = page.getByTestId('form-unsaved-bar')
    await expect(bar).toBeInViewport()
    await expect(page.getByTestId('form-save')).toBeInViewport()
    await page.getByLabel('Field 29', { exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByTestId('form-save')).not.toBeInViewport()
    await expect(bar).toBeInViewport()
  })

  await session.step('reloading brings up the browser warning, and staying keeps the change', async () => {
    let kind = ''
    page.once('dialog', async (dialog) => { kind = dialog.type(); await dialog.dismiss() })
    await page.reload({ timeout: 2000 }).catch(() => {})
    expect(kind).toBe('beforeunload')
    await expect(field).toHaveValue('changed')
  })
})
