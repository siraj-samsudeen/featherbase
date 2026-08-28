import { test, expect, adminToken } from './fixtures'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// UPS-H1's typed confirmation (owner decision 2026-08-11): a run about to
// update more than CONFIRM_UPDATES_OVER (20) rows demands the number be
// typed back. The preview count is passive and easy to click past; typing
// 25 is not. Small runs stay friction-free — the existing UPS journey (8
// rows, no prompt) is the other half of this proof.

const DT = 'Confirm Guard Zones'
const N = 25 // > CONFIRM_UPDATES_OVER

test(`UPS-H1: updating ${N} rows demands the number typed back`, async ({ page, request }) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, DT)

  await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'zone', label: 'Zone', column_type: 'Data', in_list_view: true },
        { column_name: 'pop', label: 'Pop', column_type: 'Int', in_list_view: true },
      ],
    },
  })
  const seed = Array.from({ length: N }, (_, i) => ({ zone: `Z${i}`, pop: i }))
  await request.post(`/api/table/${encodeURIComponent(DT)}:import`, {
    headers,
    data: { rows: seed },
  })

  // The corrected file: every row's pop changes → N updates.
  const ws = XLSX.utils.aoa_to_sheet([
    ['Zone', 'Pop'],
    ...seed.map((r) => [r.zone, r.pop + 1000]),
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Zones')

  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'mass-update.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  })
  await expect(page.getByTestId('iw-target-0')).toHaveValue(DT)
  await page.getByTestId('iw-key-0').selectOption('zone')

  // Import → the guard appears instead of the run; nothing was written.
  await page.getByTestId('iw-import').click()
  const guard = page.getByTestId('iw-confirm-updates')
  await expect(guard).toContainText(`update ${N} existing rows`)
  const anyRow = (await (
    await request.get(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
        '["pop"]',
      )}&limit_page_length=1`,
      { headers },
    )
  ).json()) as { data: { pop: unknown }[] }
  expect(Number(anyRow.data[0].pop)).toBeLessThan(1000) // still the seeded value

  // A wrong number keeps the trigger disabled; the exact number arms it.
  await page.getByTestId('iw-confirm-input').fill(String(N - 1))
  await expect(page.getByTestId('iw-confirm-go')).toBeDisabled()
  await page.getByTestId('iw-confirm-input').fill(String(N))
  await expect(page.getByTestId('iw-confirm-go')).toBeEnabled()
  await page.getByTestId('iw-confirm-go').click()

  // The run proceeds normally (single sheet → the ratified auto-navigation).
  await expect(page).toHaveURL(new RegExp(`/admin/${encodeURIComponent(DT)}`))
  const after = (await (
    await request.get(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
        '["pop"]',
      )}&limit_page_length=100`,
      { headers },
    )
  ).json()) as { data: { pop: unknown }[] }
  expect(after.data).toHaveLength(N)
  expect(after.data.every((r) => Number(r.pop) >= 1000)).toBe(true)

  // Teardown — self-cleaning via table deletion (spec 0003).
  const del = await request.delete(`/api/table_def/${encodeURIComponent(DT)}`, { headers })
  expect(del.status()).toBe(200)
})
