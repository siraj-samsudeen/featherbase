import { tableSlug } from 'shared'
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
    columns: [
      { column_name: 'customer', column_type: 'Data', label: 'Customer' },
      { column_name: 'paid', column_type: 'Check', label: 'Paid' },
      { column_name: 'sent', column_type: 'Check', label: 'Sent' },
      { column_name: 'notes', column_type: 'Data', label: 'Notes' },
    ],
  })
  await admin.post('/api/save_row', { table: DT, row: { row_id: 'pv-1', customer, paid: true, sent: false } })
  await admin.post('/api/save_row', {
    table: 'Letter Head',
    row: { row_id: 'Pv Main', is_default: true, header_html: '<p>MAIN HEADER for {{ customer }}</p>', footer_html: '<p>MAIN FOOTER</p>' },
  })
  await admin.post('/api/save_row', {
    table: 'Letter Head',
    row: { row_id: 'Pv Branch', is_default: false, header_html: '<p>BRANCH HEADER</p>', footer_html: '' },
  })
}

const printUrl = () => `/featherbase/print/${encodeURIComponent(tableSlug(DT))}/pv-1`

test('the default letterhead appears on the print page without choosing one', async ({ admin }) => {
  await setup(admin)
  await renderApp(printUrl(), admin)
  expect(await screen.findByTestId('letter-head-header')).toHaveTextContent('MAIN HEADER for Wayne Enterprises')
  expect(screen.getByTestId('letter-head-footer')).toHaveTextContent('MAIN FOOTER')
  // A plain page: just the row, no menus or navigation around it.
  expect(screen.queryByTestId('top-bar')).toBeNull()
  expect(screen.getByTestId('print-field-customer')).toHaveTextContent('Wayne Enterprises')
  expect(screen.getByTestId('print-field-paid')).toHaveTextContent('Yes')
  expect(screen.getByTestId('print-field-sent')).toHaveTextContent('No')
  expect(screen.getByTestId('print-field-notes')).toHaveTextContent('—')
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
    row: { row_id: 'Pv Fmt', ref_table: DT, is_default: true, template: '<p>Order for {{ customer }}</p><p>Paid: {{ paid }}; Sent: {{ sent }}; Notes: {{ notes }}</p>' },
  })
  await renderApp(printUrl(), admin)
  const body = await screen.findByTestId('print-format-body')
  expect(body.querySelector('[data-injected]')).toBeNull()
  expect(body).toHaveTextContent('<img src="x" alt="injected" data-injected="1">')
  expect(body).toHaveTextContent('Paid: Yes; Sent: No; Notes:')
})

// Moved from the deleted e2e/print-formats.spec.ts (PRN-002): two formats for
// one Table print differently, and the default one is used when none is named.
async function formats(admin: TestClient) {
  await setup(admin, 'Stark Industries')
  await admin.post('/api/save_row', {
    table: 'Print Format',
    row: { row_id: 'Pv Invoice', ref_table: DT, is_default: true, template: '<div data-testid="tpl-invoice"><h2>INVOICE</h2><p>Bill to: {{ customer }}</p></div>' },
  })
  await admin.post('/api/save_row', {
    table: 'Print Format',
    row: { row_id: 'Pv Receipt', ref_table: DT, is_default: false, template: '<div data-testid="tpl-receipt">RECEIPT — {{ customer }} paid</div>' },
  })
}

test('PRN-002: with no format named, the print page uses the default format, filled in', async ({ admin }) => {
  await formats(admin)
  await renderApp(printUrl(), admin)
  expect(await screen.findByTestId('print-format-body')).toHaveAttribute('data-format', 'Pv Invoice')
  expect(screen.getByTestId('tpl-invoice')).toHaveTextContent('Bill to: Stark Industries')
  expect(screen.getByTestId('print-view')).not.toHaveTextContent('RECEIPT')
})

test('PRN-002: picking another format prints its wording instead', async ({ admin }) => {
  await formats(admin)
  const user = userEvent.setup()
  await renderApp(printUrl(), admin)
  await screen.findByTestId('tpl-invoice')
  await user.selectOptions(screen.getByTestId('print-format-picker'), 'Pv Receipt')
  expect(await screen.findByTestId('tpl-receipt')).toHaveTextContent('RECEIPT — Stark Industries paid')
  expect(screen.queryByTestId('tpl-invoice')).toBeNull()
})

test('PRN-002: a format named in the address is the one printed', async ({ admin }) => {
  await formats(admin)
  await renderApp(`${printUrl()}?format=${encodeURIComponent('Pv Receipt')}`, admin)
  expect(await screen.findByTestId('tpl-receipt')).toHaveTextContent('RECEIPT — Stark Industries paid')
  expect(screen.queryByTestId('tpl-invoice')).toBeNull()
})

test('PRN-002: choosing Standard prints the layout made from the Table, not a format', async ({ admin }) => {
  await formats(admin)
  const user = userEvent.setup()
  await renderApp(printUrl(), admin)
  await screen.findByTestId('tpl-invoice')
  await user.selectOptions(screen.getByTestId('print-format-picker'), 'standard')
  expect(await screen.findByTestId('print-auto-layout')).toHaveTextContent('Stark Industries')
  expect(screen.queryByTestId('tpl-invoice')).toBeNull()
})

// PRN-001, moved down from e2e/print-view.spec.ts (#1080): reached from the
// form's Print action, the print view shows labels, values and child tables,
// with none of the app's chrome.
test('PRN-001: print view shows labels, values, and child tables with no chrome', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', {
    name: 'Pv Item',
    kind: 'sub_table',
    columns: [
      { column_name: 'product', column_type: 'Data' },
      { column_name: 'qty', column_type: 'Int' },
    ],
  })
  await admin.post('/api/table_def', {
    name: 'Pv Lined',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'customer', column_type: 'Data', label: 'Customer' },
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Pv Item', label: 'Lines' },
    ],
  })
  await admin.post('/api/save_row', {
    table: 'Pv Lined',
    row: { row_id: 'prn-doc', customer: 'Wayne Enterprises', lines: [{ product: 'Widget', qty: 3 }, { product: 'Gadget', qty: 7 }] },
  })
  const app = await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug('Pv Lined'))}/row/prn-doc`, admin)
  await user.click(await screen.findByRole('button', { name: 'Record actions' }, { timeout: 8000 }))
  await user.click(await screen.findByTestId('form-print'))
  await waitFor(() =>
    expect((app.router as { state: { location: { pathname: string } } }).state.location.pathname)
      .toBe(`/featherbase/print/${tableSlug('Pv Lined')}/prn-doc`),
  )

  await screen.findByTestId('print-view', {}, { timeout: 8000 })
  expect(screen.queryByTestId('awesomebar')).toBeNull()
  expect(screen.queryByTestId('table-nav')).toBeNull()
  expect(screen.queryByTestId('top-bar')).toBeNull()
  expect(screen.queryByTestId('admin-sidebar')).toBeNull()
  expect(screen.getByTestId('print-docname')).toHaveTextContent('prn-doc')
  expect(screen.getByTestId('print-field-customer')).toHaveTextContent('Customer')
  expect(screen.getByTestId('print-field-customer')).toHaveTextContent('Wayne Enterprises')
  const lines = await screen.findByTestId('print-table-lines')
  expect(screen.getAllByTestId('print-table-row')).toHaveLength(2)
  expect(lines).toHaveTextContent('Widget')
  expect(lines).toHaveTextContent('Gadget')
})

test('a letterhead chosen and then set back to automatic prints the default again', async ({ admin }) => {
  await setup(admin)
  const user = userEvent.setup()
  await renderApp(printUrl(), admin)
  await screen.findByTestId('letter-head-header')
  await user.selectOptions(screen.getByTestId('letter-head-picker'), 'Pv Branch')
  await waitFor(() => expect(screen.getByTestId('letter-head-header')).toHaveTextContent('BRANCH HEADER'))
  await user.selectOptions(screen.getByTestId('letter-head-picker'), 'auto')
  await waitFor(() => expect(screen.getByTestId('letter-head-header')).toHaveTextContent('MAIN HEADER'))
})

test('a choice prints as its label, and a Sub-table with no rows says so', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Pv Line', kind: 'sub_table', columns: [{ column_name: 'item', column_type: 'Data' }] })
  await admin.post('/api/table_def', {
    name: 'Pv Ticket',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'stage', column_type: 'Choice', label: 'Stage', choices: 'open\nshut', choice_labels: { shut: 'Closed' } },
      { column_name: 'lines', column_type: 'Sub-table', label: 'Lines', row_table: 'Pv Line' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Pv Ticket', row: { row_id: 'pt-1', stage: 'shut' } })
  await renderApp(`/featherbase/print/${encodeURIComponent(tableSlug('Pv Ticket'))}/pt-1`, admin)
  expect(await screen.findByTestId('print-field-stage', {}, { timeout: 8000 })).toHaveTextContent(/Closed$/)
  expect(screen.getByTestId('print-table-lines')).toHaveTextContent('No rows')
})
