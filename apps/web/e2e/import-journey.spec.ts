import { journeyTest as test, expect, adminToken, signIn, snap } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// IMP-J1 — the first-import golden path of
// docs/design/requirements-framework.md (Part II), written in the
// feather-testing DSL: each chain segment mirrors a journey step, and
// step() carries the value assertions the UI cannot yet express through
// labels (the wizard's inputs are test-id addressed, not label-associated —
// the same finding that got the login form its htmlFor attributes).
//
// Hermeticity (adoption item 9, CLOSED by table deletion — spec 0003): the
// Table is renamed to "Journey Zones" AFTER asserting the "Zones" prefill,
// so sibling specs cannot collide, and a leftover from a prior run is
// pre-cleaned through the deletion capability instead of self-skipping.

const DT = 'Journey Zones'

test('IMP-J1: first import creates a typed Table from zones.csv', async ({
  session,
  page,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, DT)

  // J1.1 — sidebar → the import screen with an empty drop area
  await signIn(session)
    .click('Import Data')
    .assertText('Drag & drop a CSV or Excel workbook here')
  await snap(page, 'IMP-J1.1')

  // J1.2 — drop the fixture; the counts describe the FILE, never a Table
  await session
    .dropFile('[data-testid="iw-dropzone"]', 'e2e/fixtures/zones.csv')
    .assertHas('[data-testid="iw-file-name"]', { text: 'zones\\.csv' })
    .assertText('1 sheet')
    .assertText('8 rows, 6 columns in the file')
  await snap(page, 'IMP-J1.2')

  // J1.3 — on a fresh DB the target reads New Table… and nothing suggests
  // appending. On a DB that has already seen a "Zones" Table (this fixture's
  // headers fully cover it), R7 auto-selects it — which must NEVER be silent.
  // Assert whichever world we are in, then ensure the create path either way.
  const zonesTaken = (await request.get('/api/table/Zones:meta', { headers })).status() === 200
  if (zonesTaken) {
    await session
      .assertHas('[data-testid="iw-auto-matched-0"]', { text: 'Zones' })
      .step('precondition "no table yet" unmet here: retarget to New Table…', async ({ page }) => {
        await page.getByTestId('iw-target-0').click()
        await page.getByTestId('iw-target-new-0').click()
        await expect(page.getByTestId('iw-target-0')).toHaveValue('New Table…')
      })
  } else {
    await session.step('J1.3: New Table…, name prefilled "Zones", no notice', async ({ page }) => {
      await expect(page.getByTestId('iw-target-0')).toHaveValue('New Table…')
      await expect(page.getByTestId('iw-new-name-0')).toHaveValue('Zones')
      await expect(page.getByTestId('iw-auto-matched-0')).toHaveCount(0)
    })
  }

  await snap(page, 'IMP-J1.3')

  // J1.4 — six editable rows matching R1–R4 exactly (R2.7: Is Active stays
  // Check even though it clears the Choice bar, because yes/no runs first)
  await session.step('J1.4: the inferred column grid matches R1–R4', async ({ page }) => {
    const grid = page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]')
    await expect(grid).toHaveCount(6)
    const expectCol = async (row: number, name: string, type: string) => {
      await expect(grid.nth(row).locator('[data-rowfield=column_name]')).toHaveValue(name)
      await expect(grid.nth(row).locator('[data-rowfield=column_type]')).toHaveValue(type)
    }
    await expectCol(0, 'zone_name', 'Data')
    await expectCol(1, 'region', 'Choice')
    await expect(grid.nth(1)).toContainText('North, South')
    await expectCol(2, 'population', 'Int')
    await expectCol(3, 'area_sq_km', 'Float')
    await expectCol(4, 'opened_on', 'Date')
    await expectCol(5, 'is_active', 'Check')
  })

  await snap(page, 'IMP-J1.4')

  // J1.5 — the locked Row ID row heads the grid
  await session.assertHas('[data-testid="iw-row-id-0"]', { text: 'Row ID' })
  await snap(page, 'IMP-J1.5')

  // Hermeticity rename (deviation from J1.3 "changes nothing", recorded
  // above): the prefill was asserted first, so the promise is proven.
  await session.step(`rename Table to "${DT}" so re-runs cannot collide`, async ({ page }) => {
    await page.getByTestId('iw-new-name-0').fill(DT)
  })

  // J1.6 — the button counted the file's rows BEFORE the click
  await session.assertHas('[data-testid="iw-import"]', { text: 'Import 8 rows' })
  await snap(page, 'IMP-J1.6')
  await session.clickButton('Import 8 rows')

  // J1.7 — lands on the new Table's list: all eight zones, ids in the series
  await session
    .assertPath(`/admin/${encodeURIComponent(DT)}`)
    .assertHas('[data-testid="list-rows"]', { text: 'Alpha' })
    .assertHas('[data-testid="list-rows"]', { text: 'Hotel' })
  await snap(page, 'IMP-J1.7')

  // J1.8 + J1.9 — typed values and the import record, witnessed at the
  // contract tier: FormView's field labels are not yet label-associated, so
  // the UI-level control assertions join when they are (same wizard finding).
  const meta = (await (
    await request.get(`/api/table/${encodeURIComponent(DT)}:meta`, { headers })
  ).json()) as { columns: { column_name: string; column_type: string; choices: string | null }[] }
  const types = Object.fromEntries(meta.columns.map((c) => [c.column_name, c.column_type]))
  expect(types).toMatchObject({
    zone_name: 'Data',
    region: 'Choice',
    population: 'Int',
    area_sq_km: 'Float',
    opened_on: 'Date',
    is_active: 'Check',
  })
  expect(meta.columns.find((c) => c.column_name === 'region')?.choices).toBe('North\nSouth')

  const count = (await (
    await request.get(`/api/table/${encodeURIComponent(DT)}:count`, { headers })
  ).json()) as { count: number }
  expect(count.count).toBe(8)

  // R6: the pattern is the promise, not the number — verify the id shape.
  // known-gap #114: the wizard's rename does NOT re-derive the series, so
  // today ids keep the parse-time ZONES- prefix instead of following the
  // final name. Per the pins doctrine (framework §5), a passing assertion
  // must never state the wrong behaviour — so this asserts only the
  // neutral series shape, and R6's follows-the-final-name half carries NO
  // evidence claim until #114 is fixed (then assert /^JOURNEY-ZONES-\d+$/).
  const rows = (await (
    await request.get(`/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["row_id","zone_name"]')}`, {
      headers,
    })
  ).json()) as { data: { row_id: string }[] }
  expect(rows.data).toHaveLength(8)
  for (const r of rows.data) expect(r.row_id).toMatch(/^[A-Z][A-Z-]*-\d+$/)

  // J1.9 — one Import Log entry: zones.csv, 8 inserted, 0 failed, created.
  const log = (await (
    await request.get(
      `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
        '["ref_table","inserted","failed","table_created"]',
      )}&filters=${encodeURIComponent(JSON.stringify([['file_name', '=', 'zones.csv']]))}`,
      { headers },
    )
  ).json()) as { data: Record<string, unknown>[] }
  const entry = log.data.find((r) => r.ref_table === DT)
  expect(entry).toMatchObject({ table_created: true })
  expect(Number(entry?.inserted)).toBe(8)
  expect(Number(entry?.failed)).toBe(0)
})
