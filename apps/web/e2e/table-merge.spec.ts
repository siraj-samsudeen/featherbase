import { test, expect, adminToken, type APIRequestContext, type Page } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// #208 (issue #197): "suppose I imported two things and then I realized they
// are exactly the same columns but the names are, for example, in one of the
// things floor was spelled with a G, Glor... select one table and say merge
// into other table."
//
// Q5 (owner decision): Featherbase never guesses Glor → Floor. Names that
// FOLD to the same thing pair themselves; the rest is the user's to say, and
// the screen exists so they can.

const SRC = 'Merge Source Zones'
const DST = 'Merge Target Zones'

async function seed(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` }
  // The source spells it Glor, and writes the zone with a space in the name.
  await request.post('/api/table_def', {
    headers,
    data: {
      name: SRC,
      columns: [
        { column_name: 'glor', label: 'Glor', column_type: 'Data', in_list_view: true },
        { column_name: 'zone_name', label: 'Zone Name', column_type: 'Data', in_list_view: true },
        { column_name: 'pop', label: 'Pop', column_type: 'Int' },
      ],
    },
  })
  // The target spells it Floor and names the zone differently in CASE only —
  // which folding does join.
  await request.post('/api/table_def', {
    headers,
    data: {
      name: DST,
      columns: [
        { column_name: 'floor', label: 'Floor', column_type: 'Data', in_list_view: true },
        { column_name: 'zone_name', label: 'Zone', column_type: 'Data', in_list_view: true },
        { column_name: 'pop', label: 'Population', column_type: 'Int' },
      ],
    },
  })
  for (const [glor, zone, pop] of [
    ['Ground', 'Fresh', 12],
    ['Mezzanine', 'Dairy', 7],
  ] as const) {
    await request.post('/api/save_row', {
      headers,
      data: { table: SRC, row: { glor, zone_name: zone, pop } },
    })
  }
  await request.post('/api/save_row', {
    headers,
    data: { table: DST, row: { floor: 'Basement', zone_name: 'Frozen', pop: 3 } },
  })
}

test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  for (const n of [SRC, DST]) await deleteTableIfExists(request, token, n)
  await seed(request, token)
})

test.afterEach(async ({ request }) => {
  const token = await adminToken(request)
  for (const n of [SRC, DST]) await deleteTableIfExists(request, token, n)
})

test('folding pairs what it can, and refuses to guess the rest', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(SRC)}`)
  await page.getByTestId('open-merge').click()
  await expect(page.getByTestId('table-merge')).toBeVisible()

  await page.getByTestId('tm-target').selectOption(DST)
  await expect(page.getByTestId('tm-mapping')).toBeVisible()

  // zone_name and pop fold to the same names, so they pair themselves.
  await expect(page.getByTestId('tm-map-zone_name')).toHaveValue('zone_name')
  await expect(page.getByTestId('tm-map-pop')).toHaveValue('pop')
  // glor and floor do NOT fold together, and nothing pretends otherwise.
  await expect(page.getByTestId('tm-map-glor')).toHaveValue('')
  await expect(page.getByTestId('tm-tally')).toContainText('2 of 3 columns mapped')
  await expect(page.getByTestId('tm-tally')).toContainText('glor will be left behind')

  // Sample values are shown, so "are these the same thing?" is answerable.
  await expect(page.getByTestId('tm-sample-glor')).toContainText('Ground')
})

test('the user pairs Glor with Floor, and every row lands', async ({ page, request }) => {
  const token = await adminToken(request)
  await page.goto(`/admin/${encodeURIComponent(SRC)}/merge`)
  await page.getByTestId('tm-target').selectOption(DST)

  await page.getByTestId('tm-map-glor').selectOption('floor')
  await expect(page.getByTestId('tm-tally')).toContainText('3 of 3 columns mapped')

  await page.getByTestId('tm-go').click()
  await expect(page.getByTestId('tm-outcome')).toContainText(`Merged 2 rows into ${DST}`)

  const rows = await request.get(
    `/api/table/${encodeURIComponent(DST)}?fields=${encodeURIComponent(
      '["floor","zone_name","pop"]',
    )}&limit_page_length=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const data = ((await rows.json()) as { data: Record<string, unknown>[] }).data
  // The target's own row, plus both of the source's — under the target's
  // spelling.
  expect(data).toHaveLength(3)
  expect(data.map((r) => r.floor).sort()).toEqual(['Basement', 'Ground', 'Mezzanine'])
  // The Int column carried its values across intact. (Int is bigint in
  // Postgres and reaches the client as a string throughout this app — the
  // target's own pre-existing row reads the same way.)
  expect(data.map((r) => Number(r.pop)).sort((a, b) => a - b)).toEqual([3, 7, 12])

  // The source is left alone — this copied its rows, and says so.
  await expect(page.getByTestId('tm-outcome')).toContainText('still has its own rows')
  const src = await request.get(`/api/table/${encodeURIComponent(SRC)}:count`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(((await src.json()) as { count: number }).count).toBe(2)
})

test('a column left behind is left behind, and nothing else moves', async ({ page, request }) => {
  const token = await adminToken(request)
  await page.goto(`/admin/${encodeURIComponent(SRC)}/merge`)
  await page.getByTestId('tm-target').selectOption(DST)
  // Deliberately drop pop.
  await page.getByTestId('tm-map-pop').selectOption('')
  await expect(page.getByTestId('tm-tally')).toContainText('pop will be left behind')
  await page.getByTestId('tm-go').click()
  await expect(page.getByTestId('tm-outcome')).toContainText('Merged 2 rows')

  const rows = await request.get(
    `/api/table/${encodeURIComponent(DST)}?fields=${encodeURIComponent('["zone_name","pop"]')}&limit_page_length=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const data = ((await rows.json()) as { data: Record<string, unknown>[] }).data
  const merged = data.filter((r) => r.zone_name !== 'Frozen')
  expect(merged).toHaveLength(2)
  expect(merged.every((r) => r.pop === null || r.pop === undefined)).toBe(true)
})

test('a merge is an import, so it appears in the history and can be undone', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(SRC)}/merge`)
  await page.getByTestId('tm-target').selectOption(DST)
  await page.getByTestId('tm-map-glor').selectOption('floor')
  await page.getByTestId('tm-go').click()
  await expect(page.getByTestId('tm-outcome')).toBeVisible()

  // Recorded as an import of the source Table — the provenance a merge would
  // otherwise lose entirely.
  await page.goto('/admin/imports')
  const card = page.locator('[data-testid^="ib-batch-"]').first()
  await expect(card).toContainText(`Merged from ${SRC}`)
  await expect(card.getByTestId(`ib-target-${DST}`)).toBeVisible()
  await expect(card.getByTestId(`ib-appended-${DST}`)).toContainText('existing Table')

  // And undoable through the run history, like any other import.
  await page.goto(`/admin/import?table=${encodeURIComponent(DST)}`)
  await expect(page.getByTestId('iw-run-history')).toBeVisible()
  await expect(page.getByTestId('iw-run-0')).toContainText(`Merged from ${SRC}`)
})

test('nothing can be merged until a target and a column are chosen', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(SRC)}/merge`)
  await expect(page.getByTestId('tm-go')).toBeDisabled()

  await page.getByTestId('tm-target').selectOption(DST)
  await expect(page.getByTestId('tm-go')).toBeEnabled()

  for (const c of ['zone_name', 'pop']) await page.getByTestId(`tm-map-${c}`).selectOption('')
  await expect(page.getByTestId('tm-go')).toContainText('Map at least one column')
  await expect(page.getByTestId('tm-go')).toBeDisabled()
})
