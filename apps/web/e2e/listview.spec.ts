import type { PlaywrightStepContext, Session } from 'feather-testing-core/playwright'
import { test, expect, adminAuth, type Page } from './fixtures'
import { ensureListTableA, ensureTable, fillRows, LIST_DT_A as DT_A } from './fixtures-ui'

const DT_B = 'UI List B'
const RESPONSIVE_DT = 'List Toolbar Responsive'
const RESPONSIVE_CHILD = 'List Toolbar Responsive Step'

const HEADER_CONTROL_IDS = [
  'list-columns',
  'list-new',
  'open-report',
  'open-explore',
  'explore-split-toggle',
  'open-import',
  'open-columns',
  'open-merge',
  'open-kanban',
  'open-calendar',
  'open-gantt',
  'open-checklist',
  'open-naming',
  'open-permissions',
  'delete-table',
] as const

test.beforeAll(async ({ request }) => {
  const auth = await adminAuth(request)
  // The DT_A fill-to-30 is shared with filters.spec (./fixtures-ui): both
  // assert exact counts against it, and either may run first.
  await ensureListTableA(request, auth)
  await ensureTable(request, auth, {
    name: DT_B,
    columns: [
      { column_name: 'city', column_type: 'Data', label: 'City', in_list_view: true },
      { column_name: 'active', column_type: 'Check', label: 'Active', in_list_view: true },
    ],
  })
  await fillRows(request, auth, DT_B, 3, (i) => ({ city: `city-${i}`, active: i % 2 === 0 }))
  await ensureTable(request, auth, {
    name: RESPONSIVE_CHILD,
    kind: 'sub_table',
    columns: [
      { column_name: 'instruction', column_type: 'Data', label: 'Instruction' },
      { column_name: 'done', column_type: 'Check', label: 'Done' },
    ],
  })
  await ensureTable(request, auth, {
    name: RESPONSIVE_DT,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Descriptive title', in_list_view: true },
      {
        column_name: 'workflow_state',
        column_type: 'Choice',
        label: 'Current workflow status',
        choices: 'Open\nClosed',
        in_list_view: true,
      },
      {
        column_name: 'planned_start',
        column_type: 'Date',
        label: 'Planned starting date',
        in_list_view: true,
      },
      {
        column_name: 'planned_finish',
        column_type: 'Date',
        label: 'Planned finishing date',
        in_list_view: true,
      },
      {
        column_name: 'account_reference',
        column_type: 'Data',
        label: 'Customer account reference',
        in_list_view: true,
      },
      {
        column_name: 'delivery_region',
        column_type: 'Data',
        label: 'Responsible delivery region',
        in_list_view: true,
      },
      {
        column_name: 'approval_notes',
        column_type: 'Data',
        label: 'Latest approval notes',
        in_list_view: true,
      },
      {
        column_name: 'steps',
        column_type: 'Sub-table',
        label: 'Checklist steps',
        row_table: RESPONSIVE_CHILD,
      },
    ],
  })
  await fillRows(request, auth, RESPONSIVE_DT, 1, () => ({
    title: 'Responsive toolbar fixture',
    workflow_state: 'Open',
    planned_start: '2026-09-01',
    planned_finish: '2026-09-30',
    account_reference: 'ACCOUNT-REFERENCE-WITH-WIDE-CONTENT',
    delivery_region: 'Southern regional delivery team',
    approval_notes: 'Awaiting final operational approval',
    steps: [{ instruction: 'Confirm every toolbar action remains reachable', done: false }],
  }))
})

// UI-002, migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md):
// counts, sort clicks and pagination controls are all addressed by
// data-testid rather than a label or button name, so they stay in named
// steps — assertHas covers the plain presence/text/count checks the DSL CAN
// express.
test('UI-002: one generic ListView renders two different Tables with sort + pagination', async ({ session }) => {
  // --- Table A: metadata columns, pagination
  await session
    .visit(`/admin/${encodeURIComponent(DT_A)}`)
    .assertHas('[data-testid="col-title"]', { text: 'Title' })
    .assertHas('[data-testid="col-qty"]', { text: 'Qty' })
    .assertHas('[data-testid="list-total"]', { text: '30 total' })
    .assertHas('[data-testid="list-rows"] tr', { count: 20 })
    .assertHas('[data-testid="page-info"]', { text: '1–20 of 30' })

  await session.step('click to the second page', async ({ page }) => {
    await page.getByTestId('next-page').click()
  })
  await session
    .assertHas('[data-testid="page-info"]', { text: '21–30 of 30' })
    .assertHas('[data-testid="list-rows"] tr', { count: 10 })
  await session.step('pagination buttons flip state at the last page', async ({ page }) => {
    await expect(page.getByTestId('prev-page')).toBeEnabled()
    await expect(page.getByTestId('next-page')).toBeDisabled()
  })

  // --- Sorting: qty asc puts qty=0 first; desc puts qty=29 first
  await session.step('sort ascending by clicking the Qty column header', async ({ page }) => {
    await page.getByTestId('col-qty').click()
  })
  await session
    .assertHas('[data-testid="page-info"]', { text: '1–20 of 30' })
    .assertHas('[data-testid="list-rows"] tr:first-child', { text: 'item-00' })
  await session.step('sort descending by clicking Qty again', async ({ page }) => {
    await page.getByTestId('col-qty').click()
  })
  await session.assertHas('[data-testid="list-rows"] tr:first-child', { text: 'item-29' })

  // --- Table B: same component, entirely different columns
  await session
    .visit(`/admin/${encodeURIComponent(DT_B)}`)
    .assertHas('[data-testid="col-city"]', { text: 'City' })
    .assertHas('[data-testid="col-active"]', { text: 'Active' })
    .assertHas('[data-testid="list-total"]', { text: '3 total' })
    .assertHas('[data-testid="list-rows"] tr', { count: 3 })
    .assertHas('[data-testid="list-rows"]', { text: '✓' })

  // Row link navigates to the document route
  await session.step('click the first row link', async ({ page }) => {
    await page.getByTestId('list-rows').locator('tr').first().locator('a').click()
  })
  await session.assertHas('[data-testid="doc-page"]')
})

async function assertResponsiveListLayout(
  page: Page,
  screenshot: string,
  expectTableOverflow: boolean,
): Promise<void> {
  const main = page.locator('main')
  expect(
    await main.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    'Admin main must not scroll horizontally',
  ).toBe(true)

  const mainBox = await main.boundingBox()
  expect(mainBox).not.toBeNull()
  for (const id of HEADER_CONTROL_IDS) {
    const control = page.getByTestId(id)
    await expect(control).toBeVisible()
    const box = await control.boundingBox()
    expect(box, `${id} must have a rendered box`).not.toBeNull()
    expect(box!.x, `${id} must start inside Admin main`).toBeGreaterThanOrEqual(mainBox!.x)
    expect(box!.x + box!.width, `${id} must end inside Admin main`).toBeLessThanOrEqual(
      mainBox!.x + mainBox!.width + 1,
    )
  }

  const tableArea = page.getByTestId('list-table-scroll')
  expect(await tableArea.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto')
  if (expectTableOverflow) {
    expect(
      await tableArea.evaluate((element) => element.scrollWidth > element.clientWidth),
      'wide rows table must retain its own horizontal overflow',
    ).toBe(true)
    const scrollLeft = await tableArea.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
      const moved = element.scrollLeft
      element.scrollLeft = 0
      return moved
    })
    expect(scrollLeft, 'wide rows table must scroll independently').toBeGreaterThan(0)
  } else {
    expect(
      await tableArea.evaluate((element) => element.scrollWidth <= element.clientWidth),
      'rows table must fit its desktop container for this fixture',
    ).toBe(true)
  }
  await page.screenshot({ path: screenshot, fullPage: true })
}

async function openResponsiveList(session: Session<PlaywrightStepContext, Page>): Promise<void> {
  session
    .visit(`/admin/${encodeURIComponent(RESPONSIVE_DT)}`)
    .assertHas('[data-testid="list-view"]')
  for (const id of HEADER_CONTROL_IDS) session.assertHas(`[data-testid="${id}"]`)
  await session
}

test.describe('ListView toolbar phone layout', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('keeps every metadata-driven header control reachable while only the rows table scrolls sideways', async ({
    session,
  }) => {
    await openResponsiveList(session)
    await session.step('measure phone toolbar and table overflow ownership', async ({ page }) => {
      await assertResponsiveListLayout(
        page,
        '../../.amp/in/artifacts/listview-toolbar-phone.png',
        true,
      )
    })
  })
})

test.describe('ListView toolbar desktop layout', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('keeps every metadata-driven header control reachable on desktop', async ({ session }) => {
    await openResponsiveList(session)
    await session.step('measure desktop toolbar and table overflow ownership', async ({ page }) => {
      await assertResponsiveListLayout(
        page,
        '../../.amp/in/artifacts/listview-toolbar-desktop.png',
        false,
      )

      const titleBox = await page.getByRole('heading', { name: RESPONSIVE_DT }).boundingBox()
      const firstActionBox = await page.getByTestId('list-columns').boundingBox()
      expect(titleBox).not.toBeNull()
      expect(firstActionBox).not.toBeNull()
      expect(
        Math.min(titleBox!.y + titleBox!.height, firstActionBox!.y + firstActionBox!.height) -
          Math.max(titleBox!.y, firstActionBox!.y),
        'desktop title and toolbar must share a vertical band',
      ).toBeGreaterThan(0)
    })
  })
})
