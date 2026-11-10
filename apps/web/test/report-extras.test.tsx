// Report view paths the merged web coverage report (ADR 0012) showed red: the
// default columns of a Table with none marked for the list, an ungrouped CSV
// export (and one whose access-log entry the server refuses), choosing the
// chart's value column, saving or pinning refused by the server or dropped by
// the network, and rows with no value where the report groups or labels.
// URL.createObjectURL is a browser API jsdom lacks; the spy hands back the
// exported Blob so the test reads what the person would download.
import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'
import { grantRole } from 'server/test/fixtures'

type Admin = Parameters<typeof renderApp>[1]
const T = 'Rex Sale'
const ENC = encodeURIComponent(T)

afterEach(() => {
  // @ts-expect-error jsdom has neither; the tests that export install them
  delete URL.createObjectURL
  // @ts-expect-error see above
  delete URL.revokeObjectURL
})

async function seed(admin: Admin, inList = true) {
  await admin.post('/api/table_def', {
    name: T,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'region', column_type: 'Data', label: 'Region', in_list_view: inList },
      { column_name: 'amount', column_type: 'Int', label: 'Amount', in_list_view: inList },
      { column_name: 'units', column_type: 'Int', label: 'Units', in_list_view: inList },
      { column_name: 'note', column_type: 'Data', label: 'Note' },
    ],
  })
  await admin.post('/api/save_row', { table: T, row: { row_id: 's1', region: 'North', amount: 100, units: 2 } })
  await admin.post('/api/save_row', { table: T, row: { row_id: 's2', region: 'South', amount: 50, units: 7 } })
}

function captureDownloads(): Blob[] {
  const blobs: Blob[] = []
  URL.createObjectURL = (b: Blob) => {
    blobs.push(b)
    return 'blob:report'
  }
  URL.revokeObjectURL = () => {}
  return blobs
}

// jsdom's Blob has no text(); FileReader reads it as a browser would.
function textOf(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
}

async function openReport(admin: Admin, search = '') {
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(decodeURIComponent(ENC)))}/view/report${search}`, admin)
  await screen.findByTestId('report-view', {}, { timeout: 8000 })
  await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(2))
}

test('a report for an unknown Table shows Page not found instead of showing an empty report', async ({ admin }) => {
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(decodeURIComponent(ENC)))}/view/report`, admin)
  expect(await screen.findByText('Page not found')).toBeInTheDocument()
  expect(screen.queryByTestId('export-csv')).not.toBeInTheDocument()
})

test('with no column marked for the list, the report shows the first three columns', async ({ admin }) => {
  await seed(admin, false)
  await openReport(admin)
  expect(screen.getByTestId('report-head-region')).toBeInTheDocument()
  expect(screen.getByTestId('report-head-amount')).toBeInTheDocument()
  expect(screen.getByTestId('report-head-units')).toBeInTheDocument()
  expect(screen.queryByTestId('report-head-note')).not.toBeInTheDocument()
})

test('an ungrouped CSV export has a line per row and a total, and is logged', async ({ admin }) => {
  await seed(admin)
  const row = await admin.get<Record<string, unknown>>(`/api/table/${ENC}/s1`)
  await admin.post('/api/save_row', { table: T, row: { ...row, region: 'North, "Silk"\nAnnex' } })
  const blobs = captureDownloads()
  await openReport(admin)
  await userEvent.click(screen.getByTestId('export-csv'))
  await waitFor(() => expect(blobs).toHaveLength(1))
  const csv = await textOf(blobs[0])
  // The embedded newline is part of one quoted field, not another record;
  // compare the whole download so duplicate or extra records also fail.
  const records = ['s1,"North, ""Silk""\nAnnex",100,2', 's2,South,50,7']
  expect([records, [...records].reverse()].map((order) =>
    ['Name,Region,Amount,Units', ...order, 'Total (2),,150,9'].join('\n'),
  )).toContain(csv)
  await waitFor(async () => {
    const [n] = await sql`select count(*)::int as n from access_log where operation = 'export' and ref_table = ${T} and method = 'csv'`
    expect(n.n).toBe(1)
  })
})

test('an export still downloads when the server refuses to log it', async ({ admin, createUser }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Rex Reader' } })
  const [grantId] = await grantRole(admin, { table: T, role: 'Rex Reader', can_read: true })
  const reader = await createUser({ roles: ['Rex Reader'] })
  const blobs = captureDownloads()
  await openReport(reader)
  // The grant is withdrawn after the rows were shown: the log refuses the export.
  await admin.delete(`/api/table/Permission/${encodeURIComponent(grantId)}`)
  await expect(reader.post('/api/access_log', { table: T, method: 'csv' })).rejects.toMatchObject({ status: 403 })
  await userEvent.click(screen.getByTestId('export-csv'))
  await waitFor(() => expect(blobs).toHaveLength(1))
  expect(await textOf(blobs[0])).toContain('s1,North,100,2')
  const [n] = await sql`select count(*)::int as n from access_log where operation = 'export' and ref_table = ${T}`
  expect(n.n).toBe(0)
})

test('the chart can follow another number column', async ({ admin }) => {
  await seed(admin)
  await openReport(admin)
  const value = screen.getByTestId('chart-value')
  expect(value).toHaveValue('amount')
  await userEvent.selectOptions(value, 'units')
  expect(value).toHaveValue('units')
  await waitFor(() => expect(screen.getByTestId('chart-bar-South')).toHaveTextContent('7'))
})

test('saving a report on a Table deleted meanwhile, and pinning to a dashboard deleted meanwhile, are refused with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.post('/api/save_row', { table: 'Report', row: { row_id: 'Rex Report', ref_table: T, config: { columns: ['region', 'amount'] } } })
  await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: 'Rex Board', label: 'Rex Board', config: { cards: [], charts: [] } } })
  await openReport(admin, `?report=${encodeURIComponent('Rex Report')}`)

  await user.selectOptions(screen.getByTestId('pin-dashboard'), 'Rex Board')
  await admin.delete(`/api/table/Dashboard/${encodeURIComponent('Rex Board')}`)
  await user.click(screen.getByTestId('pin-chart'))
  expect(await screen.findByTestId('pin-msg')).toHaveTextContent(/not found/i)

  await user.click(screen.getByTestId('report-save'))
  await user.type(screen.getByTestId('report-save-name'), 'Rex Copy')
  await admin.delete(`/api/table_def/${ENC}`)
  await user.click(screen.getByTestId('report-save-confirm'))
  expect(await within(screen.getByTestId('report-view')).findByTestId('report-save-error')).toHaveTextContent('Invalid links for Report')
})

/** The network drops every request this says it should. */
function dropNetwork(lost: (url: string, init?: RequestInit) => boolean) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    lost(String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url), init)
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
}

test('a row with no value in the grouped column is counted in a group of its own', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: T, row: { row_id: 's3', amount: 5, units: 1 } })
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}/view/report`, admin)
  await screen.findByTestId('report-view', {}, { timeout: 8000 })
  await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(3))
  await userEvent.selectOptions(screen.getByTestId('report-groupby'), 'region')
  await waitFor(() => expect(screen.getAllByTestId('group-header')).toHaveLength(3))
})

test('a chart bar for a row with no label is drawn unlabelled', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: T, row: { row_id: 's3', amount: 5, units: 1 } })
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}/view/report`, admin)
  await screen.findByTestId('report-view', {}, { timeout: 8000 })
  await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(3))
  expect(within(screen.getByTestId('report-chart')).getByTestId('chart-bar-')).toHaveTextContent('5')
})

test('saving a report the network drops says the save failed', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openReport(admin)
  await user.click(screen.getByTestId('report-save'))
  await user.type(screen.getByTestId('report-save-name'), 'Rex Lost')
  dropNetwork((url) => url === '/api/save_row')
  await user.click(screen.getByTestId('report-save-confirm'))
  expect(await screen.findByTestId('report-save-error')).toHaveTextContent('Save failed')
})

test('pinning a chart the network drops says the pin failed', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.post('/api/save_row', { table: 'Report', row: { row_id: 'Rex Report', ref_table: T, config: { columns: ['region', 'amount'] } } })
  await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: 'Rex Board', label: 'Rex Board', config: { cards: [], charts: [] } } })
  await openReport(admin, `?report=${encodeURIComponent('Rex Report')}`)
  await user.selectOptions(screen.getByTestId('pin-dashboard'), 'Rex Board')
  dropNetwork((url) => url.includes('pin_chart'))
  await user.click(screen.getByTestId('pin-chart'))
  expect(await screen.findByTestId('pin-msg')).toHaveTextContent('Pin failed')
})
