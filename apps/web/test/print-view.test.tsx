import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TestClient } from 'feather-testing-postgres'
import { test, expect, renderApp } from './pg-test'

// Printing — what the print page itself shows: the plain page, a format's
// wording, the default letterhead and the user's choice of another or none.

const DT = 'Pv Order'

async function setup(admin: TestClient, customer = 'Wayne Enterprises') {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'customer', column_type: 'Data', label: 'Customer' }],
  })
  await admin.post('/api/save_row', { table: DT, row: { row_id: 'pv-1', customer } })
  await admin.post('/api/save_row', {
    table: 'Letter Head',
    row: { row_id: 'Pv Main', is_default: true, header_html: '<p>MAIN HEADER for {{ customer }}</p>', footer_html: '<p>MAIN FOOTER</p>' },
  })
  await admin.post('/api/save_row', {
    table: 'Letter Head',
    row: { row_id: 'Pv Branch', is_default: false, header_html: '<p>BRANCH HEADER</p>', footer_html: '' },
  })
}

const printUrl = () => `/featherbase/print/${encodeURIComponent(DT)}/pv-1`

test('the default letterhead appears on the print page without choosing one', async ({ admin }) => {
  await setup(admin)
  await renderApp(printUrl(), admin)
  expect(await screen.findByTestId('letter-head-header')).toHaveTextContent('MAIN HEADER for Wayne Enterprises')
  expect(screen.getByTestId('letter-head-footer')).toHaveTextContent('MAIN FOOTER')
  // A plain page: just the row, no menus or navigation around it.
  expect(screen.queryByTestId('top-bar')).toBeNull()
  expect(screen.getByTestId('print-field-customer')).toHaveTextContent('Wayne Enterprises')
})

test('the user can choose another letterhead, or leave it off', async ({ admin }) => {
  await setup(admin)
  const user = userEvent.setup()
  await renderApp(printUrl(), admin)
  await screen.findByTestId('letter-head-header')

  await user.selectOptions(screen.getByTestId('letter-head-picker'), 'Pv Branch')
  await waitFor(() => expect(screen.getByTestId('letter-head-header')).toHaveTextContent('BRANCH HEADER'))
  expect(screen.getByTestId('letter-head-header')).not.toHaveTextContent('MAIN HEADER')

  await user.selectOptions(screen.getByTestId('letter-head-picker'), 'none')
  await waitFor(() => expect(screen.queryByTestId('letter-head-header')).toBeNull())
  expect(screen.queryByTestId('letter-head-footer')).toBeNull()
})

// SPEC: none yet (proposed in the audit report: "values print as text, not as markup") —
// suspected defect, see report. The server's PDF page escapes row values before
// filling a format; the browser print page puts them into the page as markup.
test('a value containing markup is shown as text on the print page, not run as markup', async ({ admin }) => {
  await setup(admin, '<img src="x" alt="injected" data-injected="1">')
  await admin.post('/api/save_row', {
    table: 'Print Format',
    row: { row_id: 'Pv Fmt', ref_table: DT, is_default: true, template: '<p>Order for {{ customer }}</p>' },
  })
  await renderApp(printUrl(), admin)
  const body = await screen.findByTestId('print-format-body')
  expect(body.querySelector('[data-injected]')).toBeNull()
  expect(body).toHaveTextContent('<img src="x" alt="injected" data-injected="1">')
})
