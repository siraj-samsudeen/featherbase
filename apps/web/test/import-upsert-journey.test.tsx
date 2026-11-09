// UPS-J1 + UPS-J2, the upsert journeys of the import wizard: each seeds its
// Table through the API (the state a first import leaves behind), then walks
// the wizard over the corrected or code-carrying file. The import boundary's
// own rules are apps/server/test/import/upsert.test.ts.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent
const DT = 'Upsert Journey Zones'
const DT2 = 'Upsert Journey Coded Zones'

const ZONES_V2 = `Zone Name,Region,Population,Area Sq Km,Opened On,Is Active
Alpha,North,13500,45.5,2026-01-15,yes
Bravo,South,8400,12.25,2026-01-16,no
Charlie,North,23100,88.0,2026-01-17,yes
Delta,South,5600,7.75,2026-01-18,no
Echo,North,17200,33.5,2026-01-19,yes
Foxtrot,South,9900,21.0,2026-01-20,no
Golf,North,14500,52.25,2026-01-21,yes
Hotel,South,6300,18.5,2026-01-22,no
`
const ZONE_CODES = `Code,Zone Name,Population
REF-101,Kilo,4100
REF-102,Lima,5200
,Mike,6300
`
// zones.csv as a first import would have landed it: only Alpha differs from v2.
const ZONES = [
  { zone_name: 'Alpha', region: 'North', population: 12000, area_sq_km: 45.5, opened_on: '2026-01-15', is_active: true },
  { zone_name: 'Bravo', region: 'South', population: 8400, area_sq_km: 12.25, opened_on: '2026-01-16', is_active: false },
  { zone_name: 'Charlie', region: 'North', population: 23100, area_sq_km: 88.0, opened_on: '2026-01-17', is_active: true },
  { zone_name: 'Delta', region: 'South', population: 5600, area_sq_km: 7.75, opened_on: '2026-01-18', is_active: false },
  { zone_name: 'Echo', region: 'North', population: 17200, area_sq_km: 33.5, opened_on: '2026-01-19', is_active: true },
  { zone_name: 'Foxtrot', region: 'South', population: 9900, area_sq_km: 21.0, opened_on: '2026-01-20', is_active: false },
  { zone_name: 'Golf', region: 'North', population: 14500, area_sq_km: 52.25, opened_on: '2026-01-21', is_active: true },
  { zone_name: 'Hotel', region: 'South', population: 6300, area_sq_km: 18.5, opened_on: '2026-01-22', is_active: false },
]

function csvFile(text: string, name: string) {
  const bytes = new TextEncoder().encode(text).buffer
  const file = new File([bytes], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  return file
}

async function drop(text: string, name: string) {
  const zone = await screen.findByTestId('iw-dropzone', {}, { timeout: 8000 })
  fireEvent.drop(zone, { dataTransfer: { files: [csvFile(text, name)] } })
  await waitFor(() => expect(screen.getByTestId('iw-file-name')).toHaveTextContent(name))
}

const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

async function rows<T>(admin: Admin, table: string, fields: string[]) {
  return (await admin.get<{ data: T[] }>(
    `/api/table/${enc(table)}?fields=${enc(JSON.stringify(fields))}&limit_page_length=100`,
  )).data
}

async function seedZones(admin: Admin) {
  clearSession()
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'UPSJZ-.###',
    columns: [
      { column_name: 'zone_name', label: 'Zone Name', column_type: 'Data', in_list_view: true },
      { column_name: 'region', label: 'Region', column_type: 'Choice', choices: 'North\nSouth' },
      { column_name: 'population', label: 'Population', column_type: 'Int', in_list_view: true },
      { column_name: 'area_sq_km', label: 'Area Sq Km', column_type: 'Float' },
      { column_name: 'opened_on', label: 'Opened On', column_type: 'Date' },
      { column_name: 'is_active', label: 'Is Active', column_type: 'Check' },
    ],
  })
  const seeded = await admin.post<{ inserted: number }>(`/api/table/${enc(DT)}:import`, {
    rows: ZONES, context: { file_name: 'zones.csv', sheet_name: 'zones' },
  })
  expect(seeded.inserted).toBe(8)
}

async function openOnZonesV2(admin: Admin) {
  await renderApp(`/featherbase/admin/import?table=${enc(DT)}`, admin)
  await drop(ZONES_V2, 'zones-v2.csv')
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue(DT))
}

test('UPS-J1.1: Import from the list view opens the wizard with the Table preselected', async ({ admin }) => {
  await seedZones(admin)
  const user = userEvent.setup()
  const app = await renderApp(`/featherbase/admin/table/${enc(tableSlug(DT))}`, admin)
  await user.click(await screen.findByRole('button', { name: 'List actions' }, { timeout: 8000 }))
  await user.click(await screen.findByTestId('open-import'))
  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/import'))
  await drop(ZONES_V2, 'zones-v2.csv')
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue(DT))
  clearSession()
})

test('UPS-J1.2: the match key is a labelled control that defaults to none, with no suggestion yet', async ({ admin }) => {
  await seedZones(admin)
  await openOnZonesV2(admin)
  expect(screen.getByTestId('import-wizard')).toHaveTextContent('8 rows, 6 columns in the file')
  const key = screen.getByLabelText('Match key')
  expect(key).toHaveValue('')
  key.focus()
  expect(key).toHaveFocus()
  expect(screen.queryByTestId('iw-key-suggested-0')).not.toBeInTheDocument()
  expect(screen.queryByTestId('iw-empty-cells-0')).not.toBeInTheDocument()
  clearSession()
})

test('UPS-J1.3: choosing a match key previews the counts and offers the empty-cells choice, keep by default', async ({ admin }) => {
  await seedZones(admin)
  await openOnZonesV2(admin)
  const user = userEvent.setup()
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'zone_name')
  await waitFor(() => expect(screen.getByTestId('iw-preview-0')).toHaveTextContent('1 row changes · 7 unchanged · 0 added'), { timeout: 8000 })
  expect(screen.getByTestId('iw-empty-cells-0')).toBeInTheDocument()
  expect(screen.getByTestId('iw-empty-keep-0')).toBeChecked()
  expect(screen.getByTestId('iw-empty-clear-0')).not.toBeChecked()
  clearSession()
})

test('UPS-J1.4: Check with a match key reports the update counts and writes nothing', async ({ admin }) => {
  await seedZones(admin)
  await openOnZonesV2(admin)
  const user = userEvent.setup()
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'zone_name')
  await user.click(screen.getByTestId('iw-check'))
  await waitFor(() => expect(screen.getByTestId('iw-check-0')).toHaveTextContent('1 row changes · 7 unchanged · 0 added'), { timeout: 8000 })
  expect(await admin.get(`/api/table/${enc(DT)}:count`)).toMatchObject({ count: 8 })
  const alpha = (await rows<{ zone_name: string; population: unknown }>(admin, DT, ['zone_name', 'population']))
    .find((r) => r.zone_name === 'Alpha')
  expect(Number(alpha?.population)).toBe(12000)
  clearSession()
})

test('UPS-J1.5–7: the keyed import updates every row in place, keeps their ids and logs the counts', async ({ admin }) => {
  await seedZones(admin)
  const before = await rows<{ row_id: string; zone_name: string }>(admin, DT, ['row_id', 'zone_name'])
  expect(before).toHaveLength(8)
  const real = globalThis.fetch
  const answers: Promise<unknown>[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const res = await real(input, init)
    // The key analysis, the match preview and Check go to the same endpoint.
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { dry_run?: boolean; analyze_keys?: boolean }) : {}
    const rehearsal = Boolean(body.dry_run || body.analyze_keys)
    if (init?.method === 'POST' && String(input).endsWith(`/api/table/${enc(DT)}:import`) && !rehearsal) answers.push(res.clone().json())
    return res
  })
  const app = await renderApp(`/featherbase/admin/import?table=${enc(DT)}`, admin)
  await drop(ZONES_V2, 'zones-v2.csv')
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue(DT))
  const user = userEvent.setup()
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'zone_name')
  await user.click(await screen.findByRole('button', { name: 'Import 8 rows' }))

  // A single-sheet import goes on to the list, so its result panel is not
  // durable: the counts are the real import answer's.
  await waitFor(() => expect(here(app)).toBe(`/featherbase/admin/table/${tableSlug(DT)}`), { timeout: 15000 })
  expect(answers).toHaveLength(1)
  expect(await answers[0]).toMatchObject({ updated: 8, inserted: 0, failed: [] })
  await waitFor(() => expect(within(screen.getByTestId('list-rows')).getByText('Alpha')).toBeInTheDocument(), { timeout: 8000 })

  const after = await rows<{ row_id: string; zone_name: string; population: unknown }>(admin, DT, ['row_id', 'zone_name', 'population'])
  expect(after).toHaveLength(8) // not 16
  const byZone = Object.fromEntries(after.map((r) => [r.zone_name, r]))
  expect(Number(byZone.Alpha.population)).toBe(13500)
  expect(Number(byZone.Bravo.population)).toBe(8400)
  for (const r of before) expect(byZone[r.zone_name].row_id).toBe(r.row_id)

  const log = await admin.get<{ data: Record<string, unknown>[] }>(
    `/api/table/${enc('Import Log')}?fields=${enc('["ref_table","updated","inserted","failed","key_column"]')}&filters=${enc(JSON.stringify([['file_name', '=', 'zones-v2.csv']]))}`,
  )
  const entry = log.data.find((r) => r.ref_table === DT)
  expect(Number(entry?.updated)).toBe(8)
  expect(Number(entry?.inserted)).toBe(0)
  expect(Number(entry?.failed)).toBe(0)
  expect(entry?.key_column).toBe('zone_name')
  clearSession()
}, 30000)

test('UPS-R5: a remembered match key comes back as a suggestion, active only once accepted', async ({ admin }) => {
  await seedZones(admin)
  await admin.post(`/api/table/${enc(DT)}:import`, {
    key_column: 'zone_name', rows: [{ zone_name: 'Alpha', population: 13500 }], context: { file_name: 'zones-v2.csv' },
  })
  await openOnZonesV2(admin)
  await waitFor(() => expect(screen.getByTestId('iw-key-suggested-0')).toHaveTextContent('Match on Zone Name, as last time'), { timeout: 8000 })
  expect(screen.getByTestId('iw-key-0')).toHaveValue('')
  expect(screen.queryByTestId('iw-empty-cells-0')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Match on Zone Name' }))
  expect(screen.getByTestId('iw-key-0')).toHaveValue('zone_name')
  expect(screen.getByTestId('iw-empty-keep-0')).toBeChecked()
  clearSession()
})

async function codedTable(admin: Admin, residents: Record<string, unknown>[]) {
  clearSession()
  await admin.post('/api/table_def', {
    name: DT2,
    id_pattern: 'UPSJC-.###',
    columns: [
      { column_name: 'zone_name', label: 'Zone Name', column_type: 'Data', in_list_view: true },
      { column_name: 'population', label: 'Population', column_type: 'Int', in_list_view: true },
    ],
  })
  await admin.post(`/api/table/${enc(DT2)}:import`, { rows: residents })
}

// The colliding resident: a row already holding the file's REF-102 code.
const RESIDENT = { row_id: 'REF-102', zone_name: 'Resident', population: 1 }

async function openOnCodes(admin: Admin) {
  await renderApp(`/featherbase/admin/import?table=${enc(DT2)}`, admin)
  await drop(ZONE_CODES, 'zone-codes.csv')
  expect(screen.getByTestId('import-wizard')).toHaveTextContent('3 rows, 3 columns in the file')
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue(DT2))
  const user = userEvent.setup()
  await user.selectOptions(screen.getByTestId('iw-map-0-0'), 'row_id') // Code → Row ID
  expect(screen.getByTestId('iw-map-0-0')).toHaveValue('row_id')
  return user
}

test('UPS-J2: without a match key the file’s codes become the ids, a colliding code fails by its row and the series continues', async ({ admin }) => {
  await codedTable(admin, [RESIDENT])
  const user = await openOnCodes(admin)
  await user.click(screen.getByRole('button', { name: 'Import 3 rows' }))
  const result = await screen.findByTestId('iw-result-0', {}, { timeout: 15000 })
  expect(result).toHaveTextContent('Imported 2 rows')
  expect(result).toHaveTextContent('1 failed')
  expect(result).toHaveTextContent('row 3')
  expect(result).toHaveTextContent('already exists')

  const byZone = Object.fromEntries(
    (await rows<{ row_id: string; zone_name: string }>(admin, DT2, ['row_id', 'zone_name'])).map((r) => [r.zone_name, r.row_id]),
  )
  expect(byZone.Kilo).toBe('REF-101')
  expect(byZone.Resident).toBe('REF-102')
  expect(byZone.Lima).toBeUndefined()
  expect(byZone.Mike).toMatch(/^UPSJC-\d+$/)
  clearSession()
}, 30000)

test('UPS-J2 branch: with the Row ID as the match key a colliding code updates its row in place', async ({ admin }) => {
  // The state the keyless run above leaves: Kilo landed as REF-101, Mike
  // took a series id, REF-102 is still the resident.
  await codedTable(admin, [RESIDENT, { row_id: 'REF-101', zone_name: 'Kilo', population: 4100 }, { zone_name: 'Mike', population: 6300 }])
  const user = await openOnCodes(admin)
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'row_id')
  // The code-less row now fails: a row without a key cannot claim a match.
  await waitFor(() => expect(screen.getByTestId('iw-preview-0')).toHaveTextContent(
    '1 row changes · 1 unchanged · 0 added · 0 skipped · 1 refused',
  ), { timeout: 8000 })
  await user.click(screen.getByRole('button', { name: 'Import 3 rows' }))
  const result = await screen.findByTestId('iw-result-0', {}, { timeout: 15000 })
  expect(result).toHaveTextContent('Recorded 2 processed matches and added 0 rows')
  expect(result).toHaveTextContent('1 failed')

  const all = await rows<{ row_id: string; zone_name: string; population: unknown }>(admin, DT2, ['row_id', 'zone_name', 'population'])
  expect(all).toHaveLength(3) // updated in place, nothing doubled
  const lima = all.find((r) => r.row_id === 'REF-102')
  expect(lima?.zone_name).toBe('Lima')
  expect(Number(lima?.population)).toBe(5200)
  clearSession()
}, 30000)
