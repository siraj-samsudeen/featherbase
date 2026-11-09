// Moved from e2e/system-settings-global.spec.ts (SET-004, #1080): System
// Settings are applied globally to rendering — dates read DD-Mon-YYYY, rupees
// group the Indian way, another currency keeps its own grouping, and a change
// re-renders without any per-Table code. The formatting rules themselves are
// display-settings.test.ts; this proves the saved settings reach the screens.
import { screen, waitFor } from '@testing-library/react'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Set4 Item'
const LIST = `/featherbase/admin/table/${tableSlug(DT)}`

async function seed(admin: Admin, settings: Record<string, unknown>) {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'due', column_type: 'Date', in_list_view: true },
      { column_name: 'amount', column_type: 'Currency', in_list_view: true },
    ],
  })
  // 9 March 2026, an amount past a lakh so Indian and western grouping differ.
  await admin.post('/api/save_row', { table: DT, row: { row_id: 'set4-doc', due: '2026-03-09', amount: 1234567.5 } })
  await admin.post('/api/save_row', { table: 'System Settings', row: settings })
}

/** Exact text: "₹12,34,567.50" must not pass for a longer string. */
const textOf = (testid: string) => screen.getByTestId(testid).textContent

test('SET-004: with the defaults, the list and the form read dates as DD-Mon-YYYY and rupees grouped the Indian way', async ({ admin }) => {
  await seed(admin, { date_format: 'dd-mon-yyyy', currency: 'INR', currency_precision: 2 })
  const list = await renderApp(LIST, admin)
  await waitFor(() => expect(textOf('cell-due')).toBe('09-Mar-2026'), { timeout: 8000 })
  expect(textOf('cell-amount')).toBe('₹12,34,567.50')
  list.unmount()

  await renderApp(`${LIST}/row/set4-doc`, admin)
  await waitFor(() => expect(textOf('preview-due')).toBe('09-Mar-2026'), { timeout: 8000 })
  expect(textOf('preview-amount')).toBe('₹12,34,567.50')
})

test('SET-004: another currency keeps its own grouping', async ({ admin }) => {
  await seed(admin, { date_format: 'dd-mon-yyyy', currency: 'USD', currency_precision: 2 })
  await renderApp(LIST, admin)
  await waitFor(() => expect(textOf('cell-amount')).toBe('$1,234,567.50'), { timeout: 8000 })
})

// Precision may show fewer decimals than the currency's ISO 4217 minor unit, never more (#4332).
test('SET-004: a currency precision of 0 rounds the amount to whole rupees', async ({ admin }) => {
  await seed(admin, { date_format: 'dd-mon-yyyy', currency: 'INR', currency_precision: 0 })
  await renderApp(LIST, admin)
  await waitFor(() => expect(textOf('cell-amount')).toBe('₹12,34,568'), { timeout: 8000 })
})
