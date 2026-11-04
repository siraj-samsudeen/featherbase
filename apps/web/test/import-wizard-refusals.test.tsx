// Import wizard paths the merged web coverage report (ADR 0012) still showed
// red: the match key's companions (empty cells, unticking or remapping a
// column), a rehearsal or an import the server refuses because the Table went
// meanwhile, one target failing and "Fix it", a file that cannot be read, and
// the drop zone. Refusals are the real server's.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'
import { setSession } from '../src/lib/api'
import { ImportWizard } from '../src/pages/ImportWizard'

async function upload(csv: string, name = 'zones.csv') {
  const bytes = new TextEncoder().encode(csv).buffer
  const file = new File([bytes], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
}

type Admin = Parameters<typeof renderApp>[1]

async function zoneTable(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Iwr Zone',
    columns: [
      { column_name: 'zone_name', column_type: 'Data', label: 'Zone name', unique: true },
      { column_name: 'pop', column_type: 'Int', label: 'Pop' },
      { column_name: 'note', column_type: 'Data', label: 'Note' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Iwr Zone', row: { zone_name: 'A', pop: 1 } })
}

async function openOnZones(admin: Admin) {
  clearSession()
  await zoneTable(admin)
  await renderApp('/featherbase/admin/import', admin)
  await upload('zone_name,pop,note\nA,5,x\nB,6,y\n')
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue('Iwr Zone'), { timeout: 8000 })
}

test('a match preview refused by the server disappears, while Check reports the refusal', async ({ admin }) => {
  const user = userEvent.setup()
  await openOnZones(admin)
  await admin.delete('/api/table_def/Iwr%20Zone')
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'zone_name')
  await waitFor(() => expect(screen.queryByTestId('iw-preview-pending-0')).not.toBeInTheDocument(), { timeout: 8000 })
  expect(screen.queryByTestId('iw-preview-0')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-error')).toHaveTextContent(/^Table Iwr Zone was deleted by Administrator on /)
  clearSession()
})

test('rows with data only in an excluded column are skipped by both Check and keyed import', async ({ admin }) => {
  clearSession()
  await zoneTable(admin)
  await renderApp('/featherbase/admin/import?table=Iwr%20Zone', admin)
  await upload('zone_name,pop,note\n,,not imported\n')
  const user = userEvent.setup()
  await user.click(await screen.findByTestId('iw-map-use-0-2'))
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'zone_name')
  await user.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-check-0')).toHaveTextContent('All 0 rows are ready to import')
  expect(screen.getByTestId('iw-check-skipped-0')).toHaveTextContent('1 rows have no data in the imported columns and will be skipped')
  await user.click(screen.getByTestId('iw-import'))
  await screen.findByTestId('list-view')
  expect(await admin.get('/api/table/Iwr%20Zone?fields=["zone_name","pop"]')).toMatchObject({ total: 1, data: [{ zone_name: 'A', pop: 1 }] })
  clearSession()
})

test('a remembered match key is not suggested when the file does not map that column', async ({ admin }) => {
  clearSession()
  await zoneTable(admin)
  await admin.post('/api/table/Iwr%20Zone:import', { key_column: 'zone_name', rows: [{ zone_name: 'A', pop: 2 }] })
  await renderApp('/featherbase/admin/import?table=Iwr%20Zone', admin)
  await upload('pop,note\n3,new note\n')
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue('Iwr Zone'))
  const user = userEvent.setup()
  await user.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-check-0')).toHaveTextContent('All 1 rows are ready to import')
  expect(screen.getByTestId('iw-key-0')).toHaveValue('')
  expect(screen.queryByTestId('iw-key-suggested-0')).not.toBeInTheDocument()
  expect(await admin.get('/api/table/Iwr%20Zone?fields=["zone_name","pop"]')).toMatchObject({ total: 1, data: [{ zone_name: 'A', pop: 2 }] })
  clearSession()
})

test('with a match key, empty cells can be kept or cleared, and unticking or remapping a column keeps the key', async ({ admin }) => {
  const user = userEvent.setup()
  await openOnZones(admin)
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'zone_name')
  await user.click(screen.getByTestId('iw-empty-clear-0'))
  expect(screen.getByTestId('iw-empty-clear-0')).toBeChecked()
  await user.click(screen.getByTestId('iw-empty-keep-0'))
  expect(screen.getByTestId('iw-empty-keep-0')).toBeChecked()

  // The note column (row 2) is unticked, then mapped again: the key stays.
  await user.click(screen.getByTestId('iw-map-use-0-2'))
  expect(screen.getByTestId('iw-key-0')).toHaveValue('zone_name')
  await user.selectOptions(screen.getByTestId('iw-map-0-2'), 'note')
  expect(screen.getByTestId('iw-key-0')).toHaveValue('zone_name')
  clearSession()
})

test('a check or an import against a Table deleted meanwhile is refused with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await openOnZones(admin)
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'zone_name')
  await admin.delete('/api/table_def/Iwr%20Zone')
  await user.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-error')).toHaveTextContent(/^Table Iwr Zone was deleted by Administrator on /)
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-error')).toHaveTextContent(/^Table Iwr Zone was deleted by Administrator on /))
  clearSession()
})

test('a target the server refuses is named with the reason, and Fix it returns to it', async ({ admin }) => {
  const user = userEvent.setup()
  await openOnZones(admin)
  await admin.delete('/api/table_def/Iwr%20Zone')
  await user.click(screen.getByTestId('iw-import'))
  const failure = await screen.findByTestId('iw-failure-0', {}, { timeout: 8000 })
  expect(failure).toHaveTextContent(/^✗ Iwr Zone failed — Table Iwr Zone was deleted by Administrator on .+ Fix it$/)
  await user.click(within(failure).getByTestId('iw-failure-goto-0'))
  expect(screen.getByTestId('iw-target-0')).toHaveValue('Iwr Zone')
  clearSession()
})

test('a file that cannot be read says why; the drop zone opens the picker and shows a drag over it', async ({ admin }) => {
  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  const zone = await screen.findByTestId('iw-dropzone', {}, { timeout: 8000 })
  const picker = screen.getByTestId('iw-file-input')
  let opened = 0
  picker.addEventListener('click', () => opened++)
  fireEvent.click(zone)
  expect(opened).toBe(1)
  fireEvent.dragOver(zone)
  expect(zone.className).toMatch(/(^|\s)border-action(\s|$)/)
  fireEvent.dragLeave(zone)
  expect(zone.className).not.toMatch(/(^|\s)border-action(\s|$)/)
  await upload('\n\n', 'empty.csv')
  expect(await screen.findByTestId('iw-error')).toHaveTextContent('The file has no sheet with a header row and data')
  clearSession()
})

test('a long sheet previews its first fifty rows, then the failing rows past them after a gap', async ({ admin }) => {
  const user = userEvent.setup()
  clearSession()
  await zoneTable(admin)
  await renderApp('/featherbase/admin/import', admin)
  const lines = ['zone_name,pop,note']
  for (let n = 1; n <= 60; n++) lines.push(`Z${n},${n === 57 ? 'many' : n},x`)
  await upload(`${lines.join('\n')}\n`)
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue('Iwr Zone'), { timeout: 8000 })
  await user.click(screen.getByTestId('iw-check'))
  // Excel numbering: the header is row 1, so data row 57 is row 58.
  expect(await screen.findByTestId('iw-preview-row-0-58', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.getByTestId('iw-preview-gap-0')).toHaveTextContent('… 9 more rows')
  expect(screen.queryByTestId('iw-preview-row-0-55')).not.toBeInTheDocument()
  clearSession()
})

test('#851 a changed database invalidates a previously typed import count', async ({ admin }) => {
  clearSession()
  await admin.post('/api/table_def', { name: 'Iwr Zone', columns: [
    { column_name: 'zone_name', column_type: 'Data' },
    { column_name: 'pop', column_type: 'Int' },
  ] })
  const rows = Array.from({ length: 22 }, (_, i) => ({ zone_name: `Z${i}`, pop: 100 + i }))
  await admin.post('/api/table/Iwr%20Zone:import', { rows })
  await renderApp('/featherbase/admin/import?table=Iwr%20Zone', admin)
  await upload(['zone_name,pop', ...rows.map((r, i) => `${r.zone_name},${r.pop + (i < 21 ? 7 : 0)}`)].join('\n'))
  const user = userEvent.setup()
  await user.selectOptions(await screen.findByTestId('iw-key-0'), 'zone_name')
  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-confirm-updates')).toHaveTextContent('Type 21 to confirm')
  await admin.post('/api/table/Iwr%20Zone:import', { key_column: 'zone_name', rows: [{ zone_name: 'Z21', pop: 999 }] })
  await user.type(screen.getByTestId('iw-confirm-input'), '21')
  await user.click(screen.getByTestId('iw-confirm-go'))
  await waitFor(() => expect(screen.getByTestId('iw-confirm-updates')).toHaveTextContent('Type 22 to confirm'))
  expect(screen.getByTestId('iw-confirm-input')).toHaveValue('')
  expect(screen.getByTestId('iw-confirm-go')).toBeDisabled()
  expect(await admin.get('/api/table/Iwr%20Zone?fields=["zone_name","pop"]&order_by=zone_name%20asc')).toMatchObject({
    total: 22, data: expect.arrayContaining([{ zone_name: 'Z0', pop: 100 }]),
  })
  clearSession()
})

async function consentZones(admin: Admin, count = 21) {
  clearSession()
  await admin.post('/api/table_def', { name: 'Iwr Zone', columns: [
    { column_name: 'zone_name', column_type: 'Data', label: 'Zone name' },
    { column_name: 'pop', column_type: 'Int' },
    { column_name: 'note', column_type: 'Data' },
  ] })
  const rows = Array.from({ length: count }, (_, i) => ({ zone_name: `Z${String(i).padStart(2, '0')}`, pop: 100 + i }))
  await admin.post('/api/table/Iwr%20Zone:import', { rows })
  return rows
}

function consentCsv(rows: { zone_name: string; pop: number }[], increase = 0) {
  return ['zone_name,pop,note', ...rows.map(row => `${row.zone_name},${row.pop + increase},`)].join('\n')
}

test('#851 a keep-clear choice invalidates pending typed consent despite the same changed count', async ({ admin }) => {
  const rows = await consentZones(admin)
  await renderApp('/featherbase/admin/import?table=Iwr%20Zone', admin)
  await upload(consentCsv(rows, 7))
  const user = userEvent.setup()
  await user.selectOptions(await screen.findByTestId('iw-key-0'), 'zone_name')
  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-confirm-updates')).toHaveTextContent('Type 21 to confirm')
  await user.type(screen.getByTestId('iw-confirm-input'), '21')
  expect(screen.getByTestId('iw-confirm-go')).toBeEnabled()

  // Notes are empty in both the stored rows and file: this choice leaves all
  // 21 changed populations unchanged, so count equality cannot replace consent.
  await user.click(screen.getByTestId('iw-empty-clear-0'))
  await waitFor(() => expect(screen.queryByTestId('iw-confirm-updates')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-confirm-updates')).toHaveTextContent('Type 21 to confirm')
  expect(screen.getByTestId('iw-confirm-input')).toHaveValue('')
  expect(screen.getByTestId('iw-confirm-go')).toBeDisabled()
  expect(await admin.get('/api/table/Iwr%20Zone?fields=["zone_name","pop"]&order_by=zone_name%20asc&limit_page_length=100')).toMatchObject({ total: 21, data: rows })

  await user.type(screen.getByTestId('iw-confirm-input'), '21')
  await user.click(screen.getByTestId('iw-confirm-go'))
  await screen.findByTestId('list-view')
  expect(await admin.get('/api/table/Iwr%20Zone?fields=["zone_name","pop"]&order_by=zone_name%20asc&limit_page_length=100')).toMatchObject({
    total: 21, data: rows.map(row => ({ ...row, pop: row.pop + 7 })),
  })
  clearSession()
})

test('#851 a mapped-column choice invalidates acknowledged append despite the same overlap', async ({ admin }) => {
  const rows = await consentZones(admin)
  await renderApp('/featherbase/admin/import?table=Iwr%20Zone', admin)
  await upload(consentCsv(rows))
  const user = userEvent.setup()
  await user.click(await screen.findByTestId('iw-import'))
  expect(await screen.findByTestId('iw-append-warning')).toHaveTextContent('21 more rows')
  await user.click(screen.getByTestId('iw-append-ack'))
  expect(screen.getByTestId('iw-append-go')).toBeEnabled()

  // Removing an empty note column does not alter the one-to-one code overlap.
  await user.click(screen.getByTestId('iw-map-use-0-2'))
  await waitFor(() => expect(screen.queryByTestId('iw-append-warning')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-append-warning')).toHaveTextContent('21 more rows')
  expect(screen.getByTestId('iw-append-ack')).not.toBeChecked()
  expect(screen.getByTestId('iw-append-go')).toBeDisabled()
  expect(await admin.get('/api/table/Iwr%20Zone?fields=["zone_name","pop"]&order_by=zone_name%20asc&limit_page_length=100')).toMatchObject({ total: 21, data: rows })

  await user.click(screen.getByTestId('iw-append-ack'))
  await user.click(screen.getByTestId('iw-append-go'))
  await screen.findByTestId('list-view')
  expect(await admin.get('/api/table/Iwr%20Zone:count')).toEqual({ count: 42 })
  clearSession()
})

test('#851 readable append-only coverage warns without offering a matching action', async ({ admin, createUser }) => {
  const rows = await consentZones(admin, 2)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Iwr Appender' } })
  await admin.post('/api/save_row', { table: 'Permission', row: {
    ref_table: 'Iwr Zone', role: 'Iwr Appender', can_read: true, can_create: true, can_write: false,
  } })
  // The generic target picker reads Table metadata; this is a read grant,
  // not System Manager or write access to the imported rows.
  await admin.post('/api/save_row', { table: 'Permission', row: {
    ref_table: 'Table', role: 'Iwr Appender', can_read: true,
  } })
  const appender = await createUser({ roles: ['Iwr Appender'] })
  await admin.post('/api/save_row', { table: 'Data Scope', row: {
    person: appender.user, allow_table: 'Table', for_value: 'Iwr Zone',
  } })
  setSession(appender.token!, { row_id: appender.user!, email: null, full_name: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({ component: ImportWizard }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  // Component boundary only: the production route remains ManageOnly. This
  // real restricted session calls Hono/Postgres via pg-test's fetch bridge;
  // it is not a normally reachable non-manager browser route or network test.
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  await upload(consentCsv(rows))
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue('Iwr Zone'))
  const user = userEvent.setup()
  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-append-warning')).toHaveTextContent('2 more rows')
  expect(screen.queryByRole('button', { name: /^Match on Zone name$/ })).not.toBeInTheDocument()
  expect(screen.getByTestId('iw-key-0')).toHaveValue('')
  expect(screen.getByTestId('iw-append-go')).toBeDisabled()
  expect(await admin.get('/api/table/Iwr%20Zone?fields=["zone_name","pop"]&order_by=zone_name%20asc')).toMatchObject({ total: 2, data: rows })
  await user.click(screen.getByTestId('iw-append-ack'))
  expect(screen.getByTestId('iw-append-go')).toBeEnabled()
  expect(await admin.get('/api/table/Iwr%20Zone:count')).toEqual({ count: 2 })
  clearSession()
})
