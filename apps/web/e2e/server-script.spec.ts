import { test, expect, adminAuth } from './fixtures'

const DT = 'SS E2E Form'

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, columns: [{ column_name: 'amount', column_type: 'Int', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  await request.delete('/api/table/Server%20Script/ss-e2e-reject', { headers })
  const s = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Server Script',
      row: {
        row_id: 'ss-e2e-reject',
        script_type: 'Document Event',
        ref_table: DT,
        event: 'validate',
        script: 'if (doc.amount < 0) frappe.throw("Amount cannot be negative")',
        enabled: true,
      },
    },
  })
  if (s.status() !== 201) throw new Error(`script: ${s.status()} ${await s.text()}`)
})

// CUST-004: a server script rejecting a save surfaces the error in the form
// (without crashing the Admin), and a valid save goes through.
test('CUST-004: a rejecting server script blocks the save in the form UI', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(DT)}/new`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  // A negative amount is rejected by the server script — the error shows.
  await page.locator('[data-field=amount]').fill('-5')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Amount cannot be negative')
  // The Admin is still alive and interactive.
  await expect(page.getByTestId('session-user')).toBeVisible()

  // A valid amount saves fine.
  await page.locator('[data-field=amount]').fill('42')
  await page.getByTestId('form-save').click()
  await page.waitForURL(new RegExp(`/admin/${encodeURIComponent(DT)}/`))
  await expect(page.getByTestId('form-status')).toHaveText('Saved')
})
