import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Feed E2E DT'
const DOC = 'feed-e2e-row'

// #101 Phase 4: the Home Page activity feed — "My activity" is the caller's
// trail; "Team" (System Manager only) shows changes, never reads.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const dt = await request.post('/api/table_def', {
    headers: auth,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const created = await request.post('/api/save_row', {
    headers: auth,
    data: { table: DT, row: { row_id: DOC, title: 'v1' } },
  })
  if (![201, 409, 417].includes(created.status())) throw new Error(`row: ${created.status()}`)
})

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

test('#101 P4: my trail and the team changes surface on the Home Page', async ({
  page,
  request,
}) => {
  // Make the edit NOW, so it is the newest Version and cannot fall outside
  // the team feed's window however many specs ran before this one.
  const auth = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await auth.json()) as { token: string }).token
  const row = await request.get(
    `/api/table/${encodeURIComponent(DT)}/${encodeURIComponent(DOC)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const { updated_at, title } = (await row.json()) as { updated_at: string; title: string }
  const edited = await request.post('/api/save_row', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      table: DT,
      row: { row_id: DOC, title: title === 'v1' ? 'v2' : 'v1', updated_at },
    },
  })
  if (edited.status() !== 200 && edited.status() !== 201)
    throw new Error(`edit: ${edited.status()}`)

  await login(page)

  // Generate a read event, then land on the Home Page.
  await page.goto(`/admin/${encodeURIComponent(DT)}/${DOC}`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await page.goto('/admin')
  await expect(page.getByTestId('activity-feed')).toBeVisible()

  // Mine: the visit lands after the client's ~3s batch flush — poll through
  // reloads until the feed's fresh fetch carries it.
  await expect
    .poll(
      async () => {
        await page.reload()
        await page.getByTestId('activity-feed').waitFor()
        return page.getByTestId('feed-item').filter({ hasText: DOC }).count()
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0)

  // Team (Administrator is a System Manager): the edit shows as a change;
  // the privacy footer states the reads-are-never-shown rule.
  await page.getByTestId('feed-tab-team').click()
  const change = page.getByTestId('feed-item').filter({ hasText: DOC }).first()
  await expect(change).toContainText('change')
  await expect(page.getByTestId('activity-feed')).toContainText('never shown')

  // The change entry links back to the row.
  await change.getByRole('button', { name: DOC }).click()
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))
  await expect(page.getByTestId('form-view')).toBeVisible()
})
