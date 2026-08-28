import { journeyTest as test, expect, adminToken, signIn, snap } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// UPS-J1 + UPS-J2 — the upsert journeys of docs/specs/0004-import-upsert.md,
// in the feather-testing DSL. Prior state is residue-shaped (trial #1
// finding): each journey seeds its Table through the API — the state
// Spreadsheet Import leaves behind — then walks the wizard over the
// corrected / code-carrying file.
//
// Isolation: self-cleaning through table deletion (spec 0003) — pre-clean
// via deleteTableIfExists, teardown deletes the Table (sweeping its Import
// Log rows, DEL-R4). No skip path.

const DT = 'Upsert Journey Zones'
const DT2 = 'Upsert Journey Coded Zones'

// The zones.csv rows, typed as the wizard's first import would have landed
// them (the residue of IMP-J1, seeded at the contract tier).
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

test('UPS-J1: re-import the corrected file on the Zone Name key', async ({
  session,
  page,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, DT)

  // Prior state: the Table Spreadsheet Import leaves behind — 8 typed rows,
  // series ids, an Import Log entry (the API import logs one).
  await request.post('/api/table_def', {
    headers,
    data: {
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
    },
  })
  const seeded = await request.post(`/api/table/${encodeURIComponent(DT)}:import`, {
    headers,
    data: { rows: ZONES, context: { file_name: 'zones.csv', sheet_name: 'zones' } },
  })
  expect(((await seeded.json()) as { inserted: number }).inserted).toBe(8)
  const idsBefore = (await (
    await request.get(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["row_id","zone_name"]')}&limit_page_length=100`,
      { headers },
    )
  ).json()) as { data: { row_id: string; zone_name: string }[] }
  expect(idsBefore.data).toHaveLength(8)

  // J1.1 — the existing Table's list view → Import: the wizard opens with
  // the Table preselected (IMP-R7's entry variant, unchanged).
  await signIn(session)
    .visit(`/admin/${encodeURIComponent(DT)}`)
    .assertHas('[data-testid="open-import"]')
  await session.step('J1.1: Import from the list view preselects the Table', async ({ page }) => {
    await page.getByTestId('open-import').click()
  })
  await snap(page, 'UPS-J1.1')

  // J1.2 — drop the corrected file: the mapping step as today PLUS the
  // Match key control — labelled, keyboard-reachable, defaulting to none
  // (append-always stays the default). No key was ever used on this Table,
  // so nothing is suggested; the empty-cells choice is not yet shown.
  await session
    .dropFile('[data-testid="iw-dropzone"]', 'e2e/fixtures/zones-v2.csv')
    .assertHas('[data-testid="iw-file-name"]', { text: 'zones-v2\\.csv' })
    .assertText('8 rows, 6 columns in the file')
  await session.step('J1.2: Match key control present, labelled, defaulting to none', async ({ page }) => {
    await expect(page.getByTestId('iw-target-0')).toHaveValue(DT)
    // getByLabel proves the <label htmlFor> association — the control is a
    // real labelled form control, reachable without a pointer.
    await expect(page.getByLabel('Match key')).toHaveValue('')
    await page.getByLabel('Match key').focus()
    await expect(page.getByLabel('Match key')).toBeFocused()
    await expect(page.getByTestId('iw-key-suggested-0')).toHaveCount(0)
    await expect(page.getByTestId('iw-empty-cells-0')).toHaveCount(0)
  })
  await snap(page, 'UPS-J1.2')

  // J1.3 — mark Zone Name as the match key: real counts BEFORE anything
  // commits, and the empty-cells choice appears beside it, defaulting keep.
  await session.step('J1.3: preview counts and the empty-cells choice', async ({ page }) => {
    await page.getByTestId('iw-key-0').selectOption('zone_name')
    await expect(page.getByTestId('iw-preview-0')).toContainText(
      '8 rows match existing rows and will be updated; 0 will be added',
    )
    await expect(page.getByTestId('iw-empty-cells-0')).toBeVisible()
    await expect(page.getByTestId('iw-empty-keep-0')).toBeChecked()
    await expect(page.getByTestId('iw-empty-clear-0')).not.toBeChecked()
  })
  await snap(page, 'UPS-J1.3')

  // J1.4 — rehearse: the report is action-aware, nothing written.
  await session.clickButton('Check')
  await session.step('J1.4: rehearse reports update/insert counts, writes nothing', async ({ page }) => {
    await expect(page.getByTestId('iw-check-0')).toContainText(
      'All 8 rows are ready to import: 8 will update, 0 will insert',
    )
    const count = (await (
      await request.get(`/api/table/${encodeURIComponent(DT)}:count`, { headers })
    ).json()) as { count: number }
    expect(count.count).toBe(8)
  })
  await snap(page, 'UPS-J1.4')

  // J1.5 — Import: completion reports updated / inserted as separate counts.
  await session.clickButton('Import 8 rows')
  await session.step('J1.5: completion reports separate counts', async ({ page }) => {
    await expect(page.getByTestId('iw-result-0')).toContainText('Updated 8 and added 0 rows')
  })
  await snap(page, 'UPS-J1.5')

  // J1.6 — still 8 rows, Alpha corrected, every row keeps its original id.
  await session
    .assertPath(`/admin/${encodeURIComponent(DT)}`)
    .assertHas('[data-testid="list-rows"]', { text: 'Alpha' })
  await snap(page, 'UPS-J1.6')
  const after = (await (
    await request.get(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
        '["row_id","zone_name","population"]',
      )}&limit_page_length=100`,
      { headers },
    )
  ).json()) as { data: { row_id: string; zone_name: string; population: unknown }[] }
  expect(after.data).toHaveLength(8) // not 16
  const byZone = Object.fromEntries(after.data.map((r) => [r.zone_name, r]))
  expect(Number(byZone.Alpha.population)).toBe(13500)
  expect(Number(byZone.Bravo.population)).toBe(8400)
  for (const r of idsBefore.data) expect(byZone[r.zone_name].row_id).toBe(r.row_id)

  // J1.7 — the run's history entry carries updated and inserted separately.
  const log = (await (
    await request.get(
      `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
        '["ref_table","updated","inserted","failed","key_column","empty_cells"]',
      )}&filters=${encodeURIComponent(JSON.stringify([['file_name', '=', 'zones-v2.csv']]))}`,
      { headers },
    )
  ).json()) as { data: Record<string, unknown>[] }
  const entry = log.data.find((r) => r.ref_table === DT)
  expect(Number(entry?.updated)).toBe(8)
  expect(Number(entry?.inserted)).toBe(0)
  expect(Number(entry?.failed)).toBe(0)
  expect(entry?.key_column).toBe('zone_name')

  // UPS-R5 — a fresh visit: the remembered key is PRE-FILLED as a visible
  // suggestion ("Match on Zone Name, as last time"), never silently active.
  await session
    .visit(`/admin/import?table=${encodeURIComponent(DT)}`)
    .dropFile('[data-testid="iw-dropzone"]', 'e2e/fixtures/zones-v2.csv')
  await session.step('UPS-R5: the key comes back as a visible suggestion', async ({ page }) => {
    await expect(page.getByTestId('iw-key-suggested-0')).toContainText(
      'Match on Zone Name, as last time',
    )
    await expect(page.getByTestId('iw-key-0')).toHaveValue('zone_name')
    await expect(page.getByTestId('iw-empty-keep-0')).toBeChecked()
  })
  await snap(page, 'UPS-R5')

  // Teardown — self-cleaning via table deletion (spec 0003), no skip path.
  const del = await request.delete(`/api/table_def/${encodeURIComponent(DT)}`, { headers })
  expect(del.status()).toBe(200)
})

test('UPS-J2: the file’s codes become the ids', async ({ session, page, request }) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, DT2)

  await request.post('/api/table_def', {
    headers,
    data: {
      name: DT2,
      id_pattern: 'UPSJC-.###',
      columns: [
        { column_name: 'zone_name', label: 'Zone Name', column_type: 'Data', in_list_view: true },
        { column_name: 'population', label: 'Population', column_type: 'Int', in_list_view: true },
      ],
    },
  })
  // The colliding resident: a row already holding the file's REF-102 code.
  await request.post(`/api/table/${encodeURIComponent(DT2)}:import`, {
    headers,
    data: { rows: [{ row_id: 'REF-102', zone_name: 'Resident', population: 1 }] },
  })

  // J2.3′ — in the mapping step (append), map the Code column onto Row ID.
  await signIn(session)
    .visit(`/admin/import?table=${encodeURIComponent(DT2)}`)
    .dropFile('[data-testid="iw-dropzone"]', 'e2e/fixtures/zone-codes.csv')
    .assertText('3 rows, 3 columns in the file')
  await session.step('J2.3′: the Row ID accepts the mapping', async ({ page }) => {
    await expect(page.getByTestId('iw-target-0')).toHaveValue(DT2)
    await page.getByTestId('iw-map-0-0').selectOption('row_id') // Code → Row ID
    await expect(page.getByTestId('iw-map-0-0')).toHaveValue('row_id')
  })
  await snap(page, 'UPS-J2.3')

  // J2.6′ + branch — import WITHOUT a match key: REF-101 lands verbatim,
  // REF-102 collides and fails by its true spreadsheet row, the code-less
  // row continues the series (mixing is allowed, IMP-R6).
  await session.clickButton('Import 3 rows')
  await session.step('J2.6′: verbatim ids, named collision, series continues', async ({ page }) => {
    await expect(page.getByTestId('iw-result-0')).toContainText('Imported 2 rows')
    await expect(page.getByTestId('iw-result-0')).toContainText('1 failed')
    await expect(page.getByTestId('iw-result-0')).toContainText('row 3')
    await expect(page.getByTestId('iw-result-0')).toContainText('already exists')
  })
  await snap(page, 'UPS-J2.6')

  const rows = (await (
    await request.get(
      `/api/table/${encodeURIComponent(DT2)}?fields=${encodeURIComponent(
        '["row_id","zone_name"]',
      )}&limit_page_length=100`,
      { headers },
    )
  ).json()) as { data: { row_id: string; zone_name: string }[] }
  const byZone = Object.fromEntries(rows.data.map((r) => [r.zone_name, r.row_id]))
  expect(byZone.Kilo).toBe('REF-101') // the file's code, verbatim
  expect(byZone.Resident).toBe('REF-102') // insert-mode collision left it untouched
  expect(byZone.Lima).toBeUndefined()
  // IMP-R6: the pattern is the promise, not the number — the counter is
  // global and survives table deletion, so a re-run sees a later value.
  expect(byZone.Mike).toMatch(/^UPSJC-\d+$/) // series continues for unsupplied rows

  // Branch, second half — with the Row ID as the match key the collision IS
  // an update (that is UPS-J1's mechanics): preview says so, and the
  // code-less row now fails — a row without a key cannot claim a match.
  await session
    .visit(`/admin/import?table=${encodeURIComponent(DT2)}`)
    .dropFile('[data-testid="iw-dropzone"]', 'e2e/fixtures/zone-codes.csv')
  await session.step('J2 branch: Row ID as match key turns collisions into updates', async ({ page }) => {
    await page.getByTestId('iw-map-0-0').selectOption('row_id')
    await page.getByTestId('iw-key-0').selectOption('row_id') // Row ID as the key
    await expect(page.getByTestId('iw-preview-0')).toContainText(
      '2 rows match existing rows and will be updated; 0 will be added; 1 will fail',
    )
  })
  await session.clickButton('Import 3 rows')
  await session.step('the keyed re-import updates in place', async ({ page }) => {
    await expect(page.getByTestId('iw-result-0')).toContainText('Updated 2 and added 0 rows')
    await expect(page.getByTestId('iw-result-0')).toContainText('1 failed')
  })
  const afterKeyed = (await (
    await request.get(
      `/api/table/${encodeURIComponent(DT2)}?fields=${encodeURIComponent(
        '["row_id","zone_name","population"]',
      )}&limit_page_length=100`,
      { headers },
    )
  ).json()) as { data: { row_id: string; zone_name: string; population: unknown }[] }
  expect(afterKeyed.data).toHaveLength(3) // updated in place, nothing doubled
  const lima = afterKeyed.data.find((r) => r.row_id === 'REF-102')
  expect(lima?.zone_name).toBe('Lima') // the resident row took the file's values
  expect(Number(lima?.population)).toBe(5200)

  const del = await request.delete(`/api/table_def/${encodeURIComponent(DT2)}`, { headers })
  expect(del.status()).toBe(200)
})
