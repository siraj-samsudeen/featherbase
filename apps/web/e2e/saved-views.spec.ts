import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'SavedView DT'
const DOC = 'sv-target-row'
const FILTERS = encodeURIComponent(JSON.stringify([['note', '=', 'hot']]))

// #101 Phase 6: the same filter set applied 3× inside a week triggers the
// save-as-view nudge; the saved view becomes a chip that re-applies the
// whole set, can be shared, and can be deleted.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const dt = await request.post('/api/table_def', {
    headers: auth,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'note', column_type: 'Data', in_list_view: true }],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: { row_id: DOC, note: 'hot' },
  })
})

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

// SavedViewsBar (apps/web/src/components/ListView.tsx) counts "the same
// filter set applied 3+ times inside a week" itself, entirely client-side:
// on every mount it reads a `{ n, t }` record out of
// `localStorage['fc-filter-count:<user>']`, keyed by `table|JSON.stringify(filters)`,
// and only bumps `n` — the thing NUDGE_THRESHOLD compares against — when the
// new arrival is more than its inline same-arrival window past the last one
// (`now - rec.t > 500`, ListView.tsx). Below the nudge threshold that update
// has no DOM or network footprint at all — nothing renders differently for
// applyCount 1 vs 2, and no request fires — so there is no UI/network signal
// to wait on. What *is* observable is the mechanism's own state: the record
// this code just wrote to localStorage. Rather than guess how long 500ms
// plus test/navigation jitter needs padding to, poll that record directly
// until it has actually aged past the dedup window, so each `page.goto` in
// the loops below is guaranteed to land as a genuinely new "arrival" instead
// of assuming a fixed sleep did the job.
const SAME_ARRIVAL_WINDOW_MS = 500 // duplicated from ListView.tsx's `now - rec.t > 500`

async function waitPastDedupWindow(page: Page, table: string, filters: unknown): Promise<void> {
  const key = `${table}|${JSON.stringify(filters)}`
  await expect
    .poll(
      () =>
        page.evaluate((k) => {
          for (let i = 0; i < localStorage.length; i++) {
            const storageKey = localStorage.key(i)
            if (!storageKey?.startsWith('fc-filter-count:')) continue
            const store = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<
              string,
              { n: number; t: number }
            >
            const rec = store[k]
            if (rec) return Date.now() - rec.t
          }
          return 0
        }, key),
      {
        message: `waiting for the "${key}" same-arrival dedup window to elapse`,
        timeout: 5000,
      },
    )
    .toBeGreaterThan(SAME_ARRIVAL_WINDOW_MS)
}

test('#101 P6: three applications trigger the nudge; the saved view lives as a chip', async ({
  page,
}) => {
  await login(page)
  const listUrl = `/admin/${encodeURIComponent(DT)}?filters=${FILTERS}`

  // First two arrivals: no nudge yet. Waiting past the dedup window (see
  // waitPastDedupWindow) between them keeps each one a distinct arrival
  // instead of collapsing into the client's same-arrival dedup.
  const filters = [['note', '=', 'hot']]
  for (let i = 0; i < 2; i++) {
    await page.goto(listUrl)
    await expect(page.getByTestId('table-page')).toBeVisible()
    await expect(page.getByTestId('filter-nudge')).toHaveCount(0)
    await waitPastDedupWindow(page, DT, filters)
  }

  // Third: the nudge offers to name the habit.
  await page.goto(listUrl)
  const nudge = page.getByTestId('filter-nudge')
  await expect(nudge).toBeVisible()
  await expect(nudge).toContainText('3×')
  await page.getByTestId('nudge-name').fill('Hot notes')
  await page.getByTestId('nudge-save').click()

  // The chip appears (active), the nudge is gone.
  const chip = page.getByTestId('saved-view-chip').filter({ hasText: 'Hot notes' })
  await expect(chip).toBeVisible()
  await expect(page.getByTestId('filter-nudge')).toHaveCount(0)

  // From a clean list, the chip re-applies the whole filter set.
  await page.goto(`/admin/${encodeURIComponent(DT)}`)
  await chip.click()
  await expect(page).toHaveURL(/filters=/)
  await expect(page.getByTestId('table-page')).toContainText(DOC)

  // Share it (control shows on the active own chip), then delete it.
  await page.getByTestId('saved-view-share').click()
  await expect(chip).toContainText('shared')
  await page.getByTestId('saved-view-delete').click()
  await expect(page.getByTestId('saved-view-chip')).toHaveCount(0)
})

test('#101 P6: "Not now" silences the nudge for that filter set', async ({ page }) => {
  await login(page)
  const coldFilters = [['note', '=', 'cold']]
  const otherFilters = encodeURIComponent(JSON.stringify(coldFilters))
  const listUrl = `/admin/${encodeURIComponent(DT)}?filters=${otherFilters}`
  for (let i = 0; i < 3; i++) {
    await page.goto(listUrl)
    await expect(page.getByTestId('table-page')).toBeVisible()
    // Arrivals inside the dedup window count once — wait past it (see
    // waitPastDedupWindow) so each of these three is a distinct arrival.
    await waitPastDedupWindow(page, DT, coldFilters)
  }
  await expect(page.getByTestId('filter-nudge')).toBeVisible()
  await page.getByTestId('nudge-dismiss').click()
  await expect(page.getByTestId('filter-nudge')).toHaveCount(0)
  // A fourth application stays quiet — the dismissal is remembered.
  await page.goto(listUrl)
  await expect(page.getByTestId('table-page')).toBeVisible()
  await expect(page.getByTestId('filter-nudge')).toHaveCount(0)
})
