// IMP-J1, the first-import golden path: zones.csv dropped onto the import
// screen becomes a typed Table, its rows numbered 1 to 8, with one Import Log
// entry. Moved from the Playwright import-journey spec (#1080), with its
// e2e/fixtures/zones.csv written out below; the server is the in-process one,
// the database rolled back.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Journey Zones'
const WAIT = { timeout: 8000 }
const ZONES = `Zone Name,Region,Population,Area Sq Km,Opened On,Is Active
Alpha,North,12000,45.5,2026-01-15,yes
Bravo,South,8400,12.25,2026-01-16,no
Charlie,North,23100,88.0,2026-01-17,yes
Delta,South,5600,7.75,2026-01-18,no
Echo,North,17200,33.5,2026-01-19,yes
Foxtrot,South,9900,21.0,2026-01-20,no
Golf,North,14500,52.25,2026-01-21,yes
Hotel,South,6300,18.5,2026-01-22,no
`
const enc = encodeURIComponent

function zonesCsv(): File {
  const bytes = new TextEncoder().encode(ZONES).buffer
  const file = new File([bytes], 'zones.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  return file
}

async function dropZones(admin: Admin) {
  clearSession()
  const r = await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByRole('link', { name: 'Import Data' }, WAIT))
  expect(await screen.findByTestId('iw-dropzone', {}, WAIT)).toHaveTextContent('Drag & drop a CSV or Excel workbook here')
  fireEvent.drop(screen.getByTestId('iw-dropzone'), { dataTransfer: { files: [zonesCsv()] } })
  await screen.findByTestId('iw-target-0', {}, WAIT)
  return r
}

const grid = () => [...within(screen.getByTestId('iw-new-grid-0')).getAllByRole('row')].filter((r) => r.hasAttribute('data-columnrow'))
const cell = (row: HTMLElement, field: string) => row.querySelector<HTMLInputElement>(`[data-rowfield=${field}]`)!

test('IMP-J1: the dropped file is described by its own counts, never a Table\'s', async ({ admin }) => {
  await dropZones(admin)
  expect(screen.getByTestId('iw-file-name')).toHaveTextContent('zones.csv — 1 sheet')
  expect(screen.getByTestId('import-wizard')).toHaveTextContent('8 rows, 6 columns in the file')
  clearSession()
})

test('IMP-J1: with no Zones Table yet, the target is a New Table named Zones, with no match notice', async ({ admin }) => {
  await dropZones(admin)
  expect(screen.getByTestId('iw-target-0')).toHaveValue('New Table…')
  expect(screen.getByTestId('iw-new-name-0')).toHaveValue('Zones')
  expect(screen.queryByTestId('iw-auto-matched-0')).not.toBeInTheDocument()
  clearSession()
})

test('IMP-J1: the inferred columns, typed from their values, under the locked Row ID', async ({ admin }) => {
  await dropZones(admin)
  expect(screen.getByTestId('iw-row-id-0')).toHaveTextContent('Row ID')
  const rows = grid()
  expect(rows.map((r) => [cell(r, 'column_name').value, cell(r, 'column_type').value])).toEqual([
    ['zone_name', 'Data'],
    ['region', 'Choice'],
    ['population', 'Int'],
    ['area_sq_km', 'Float'],
    ['opened_on', 'Date'],
    ['is_active', 'Check'],
  ])
  expect(rows[1]).toHaveTextContent('North, South')
  clearSession()
})

test('IMP-J1: importing makes the typed Table, lands on its list, and logs the import', async ({ admin }) => {
  const { router } = await dropZones(admin)
  const user = userEvent.setup()
  await user.clear(screen.getByTestId('iw-new-name-0'))
  await user.type(screen.getByTestId('iw-new-name-0'), DT)
  expect(screen.getByTestId('iw-import')).toHaveTextContent('Import 8 rows')
  await user.click(screen.getByRole('button', { name: 'Import 8 rows' }))

  await waitFor(() => expect((router.state as { location: { pathname: string } }).location.pathname)
    .toBe(`/featherbase/admin/table/${tableSlug(DT)}`), { timeout: 20_000 })
  const list = await screen.findByTestId('list-rows', {}, WAIT)
  await waitFor(() => expect(list).toHaveTextContent('Alpha'))
  expect(list).toHaveTextContent('Hotel')

  const meta = await admin.get<{ columns: { column_name: string; column_type: string; choices: string | null }[] }>(`/api/table/${enc(DT)}:meta`)
  expect(Object.fromEntries(meta.columns.map((c) => [c.column_name, c.column_type]))).toMatchObject({
    zone_name: 'Data', region: 'Choice', population: 'Int', area_sq_km: 'Float', opened_on: 'Date', is_active: 'Check',
  })
  expect(meta.columns.find((c) => c.column_name === 'region')?.choices).toBe('North\nSouth')
  expect(await admin.get(`/api/table/${enc(DT)}:count`)).toMatchObject({ count: 8 })
  // #855: an untouched naming choice numbers the new Table's rows 1, 2, 3.
  const rows = await admin.get<{ data: { row_id: string }[] }>(`/api/table/${enc(DT)}?fields=${enc('["row_id"]')}`)
  expect(rows.data.map((r) => r.row_id).sort((a, b) => Number(a) - Number(b))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])

  const log = await admin.get<{ data: Record<string, unknown>[] }>(
    `/api/table/${enc('Import Log')}?fields=${enc('["ref_table","inserted","failed","table_created"]')}&filters=${enc(JSON.stringify([['file_name', '=', 'zones.csv']]))}`,
  )
  const entry = log.data.find((r) => r.ref_table === DT)
  expect(entry).toMatchObject({ table_created: true })
  expect(Number(entry?.inserted)).toBe(8)
  expect(Number(entry?.failed)).toBe(0)
  clearSession()
}, 30_000)
