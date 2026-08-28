import { test, expect, adminToken, type APIRequestContext } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// The Explore entry points: `chain` + `select` deep-link params on the
// cross-filter workspace (#100 pattern 4), the ListView Explore split
// button (option B), and RelationMap's "Open in Explore" (option C).
//
// Fixture graph (backlinks sort by table name, so 'EX Accident' is always
// the first dependent of 'EX Vehicle', making the deep links deterministic):
//   EX Vehicle ← EX Accident.vehicle ← EX Claim.accident
//   EX Vehicle ← EX Service.vehicle

const VEHICLE = 'EX Vehicle'
const ACCIDENT = 'EX Accident'
const SERVICE = 'EX Service'
const CLAIM = 'EX Claim'

let auth: { Authorization: string }
let v1 = '' // the vehicle the deep links preselect (has 2 accidents, 1 claim)

async function createTable(
  request: APIRequestContext,
  name: string,
  columns: Record<string, unknown>[],
): Promise<void> {
  const res = await request.post('/api/table_def', { headers: auth, data: { name, columns } })
  expect([200, 201], `creating fixture Table ${name}`).toContain(res.status())
}

async function insert(
  request: APIRequestContext,
  table: string,
  data: Record<string, unknown>,
): Promise<string> {
  const res = await request.post(`/api/table/${encodeURIComponent(table)}`, {
    headers: auth,
    data,
  })
  expect([200, 201], `inserting into ${table}`).toContain(res.status())
  return ((await res.json()) as { row_id: string }).row_id
}

test.beforeAll(async ({ request }) => {
  const token = await adminToken(request)
  auth = { Authorization: `Bearer ${token}` }

  // Pre-clean in reference order (DEL-R3: referenced tables refuse deletion).
  for (const t of [CLAIM, ACCIDENT, SERVICE, VEHICLE]) await deleteTableIfExists(request, token, t)

  const title = { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }
  await createTable(request, VEHICLE, [title])
  await createTable(request, ACCIDENT, [
    title,
    { column_name: 'vehicle', column_type: 'Reference', label: 'Vehicle', reference_table: VEHICLE, in_list_view: true },
  ])
  await createTable(request, SERVICE, [
    title,
    { column_name: 'vehicle', column_type: 'Reference', label: 'Vehicle', reference_table: VEHICLE, in_list_view: true },
  ])
  await createTable(request, CLAIM, [
    title,
    { column_name: 'accident', column_type: 'Reference', label: 'Accident', reference_table: ACCIDENT, in_list_view: true },
  ])

  v1 = await insert(request, VEHICLE, { title: 'Truck 1' })
  const v2 = await insert(request, VEHICLE, { title: 'Truck 2' })
  const a1 = await insert(request, ACCIDENT, { title: 'Rear bump', vehicle: v1 })
  await insert(request, ACCIDENT, { title: 'Side scrape', vehicle: v1 })
  await insert(request, ACCIDENT, { title: 'Windshield', vehicle: v2 })
  await insert(request, SERVICE, { title: 'Oil change', vehicle: v1 })
  await insert(request, CLAIM, { title: 'Claim rear bump', accident: a1 })
})

test('a root+chain+select URL renders three panes, pane 1 preselected, downstream narrowed', async ({
  page,
}) => {
  const chain = encodeURIComponent(
    JSON.stringify([
      { mode: 'backlink', table: ACCIDENT, column: 'vehicle' },
      { mode: 'backlink', table: CLAIM, column: 'accident' },
    ]),
  )
  const select = encodeURIComponent(JSON.stringify([v1]))
  await page.goto(`/admin/explore?root=${encodeURIComponent(VEHICLE)}&chain=${chain}&select=${select}`)

  // pane 1: both vehicles listed, Truck 1 arrives already selected (chip + row)
  await expect(page.getByTestId('explore-pane1-count')).toHaveText('2')
  await expect(page.getByTestId('explore-chip')).toContainText(`${VEHICLE}: ${v1}`)
  await expect(
    page.getByTestId('explore-pane1').locator('[data-testid=explore-row][data-selected]'),
  ).toContainText('Truck 1')

  // pane 2: only Truck 1's accidents (2 of the 3)
  await expect(page.getByTestId('explore-pane2-count')).toHaveText('2')
  await expect(page.getByTestId('explore-pane2')).toContainText('Rear bump')
  await expect(page.getByTestId('explore-pane2')).not.toContainText('Windshield')

  // pane 3: claims of those accidents
  await expect(page.getByTestId('explore-pane3-count')).toHaveText('1')
  await expect(page.getByTestId('explore-pane3')).toContainText('Claim rear bump')
})

test('a malformed or stale chain degrades to the plain root, never a blank page', async ({
  page,
}) => {
  // malformed JSON: ignored outright
  await page.goto(`/admin/explore?root=${encodeURIComponent(VEHICLE)}&chain=not-json`)
  await expect(page.getByTestId('explore-pane1-count')).toHaveText('2')
  await expect(page.getByTestId('explore-pane2')).toHaveCount(0)

  // stale but well-formed: names a table that doesn't resolve — the step and
  // everything after it drop, the root pane stays up
  const stale = encodeURIComponent(
    JSON.stringify([
      { mode: 'backlink', table: 'EX Ghost', column: 'vehicle' },
      { mode: 'backlink', table: CLAIM, column: 'accident' },
    ]),
  )
  await page.goto(`/admin/explore?root=${encodeURIComponent(VEHICLE)}&chain=${stale}`)
  await expect(page.getByTestId('explore-pane1-count')).toHaveText('2')
  await expect(page.getByTestId('explore-pane2')).toHaveCount(0)
})

test('ListView split button: pick dependents, Open lands on a chained Explore', async ({
  page,
}) => {
  await page.goto(`/admin/${encodeURIComponent(VEHICLE)}`)

  // main face: bare Explore rooted at the table
  await expect(page.getByTestId('open-explore')).toBeVisible()

  // chevron panel lists the SAME chainable dependents Explore's pickers offer
  await page.getByTestId('explore-split-toggle').click()
  const panel = page.getByTestId('explore-split-panel')
  await expect(panel).toContainText(`${ACCIDENT} · vehicle`)
  await expect(panel).toContainText(`${SERVICE} · vehicle`)

  // check two dependents (the pane cap) and open
  await panel.locator('label', { hasText: `${ACCIDENT} · vehicle` }).getByRole('checkbox').check()
  await panel.locator('label', { hasText: `${SERVICE} · vehicle` }).getByRole('checkbox').check()
  await panel.getByTestId('explore-split-open').click()

  await expect(page).toHaveURL(/\/admin\/explore\?/)
  expect(page.url()).toContain('chain=')
  // pane 1 (all vehicles) + pane 2 (all accidents — nothing selected yet)
  await expect(page.getByTestId('explore-pane1-count')).toHaveText('2')
  await expect(page.getByTestId('explore-pane2-count')).toHaveText('3')
  // the second sibling cannot chain off the first (pane 3 follows pane 2's
  // table), so it degrades gracefully rather than blanking the page
  await expect(page.getByTestId('explore-pane3')).toHaveCount(0)
})

test('RelationMap: Open in Explore materializes the neighborhood narrowed to the row', async ({
  page,
}) => {
  await page.goto(`/admin/map/${encodeURIComponent(VEHICLE)}/${encodeURIComponent(v1)}`)
  await page.getByTestId('map-open-explore').click()

  await expect(page).toHaveURL(/\/admin\/explore\?/)
  // pane 1 preselected to the mapped row
  await expect(page.getByTestId('explore-chip')).toContainText(`${VEHICLE}: ${v1}`)
  // first hop: accidents of Truck 1; second hop: claims of those accidents
  await expect(page.getByTestId('explore-pane2-count')).toHaveText('2')
  await expect(page.getByTestId('explore-pane3-count')).toHaveText('1')
})
