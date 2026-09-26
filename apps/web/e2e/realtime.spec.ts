import { createSession } from 'feather-testing-core/playwright'
import {
  anonymousTest as test,
  expect,
  ADMIN_PWD,
  adminAuth,
  loginAs,
  waitForRealtime,
} from './fixtures'

const DT = 'Rt DT'
const OTHER_USER = 'rt-user@x.com'
const OTHER_PWD = 'rtpw12345'

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  // A second real user for the mention/notification test.
  await request.post('/api/save_row', {
    headers,
    data: { table: 'User', row: { row_id: OTHER_USER, email: OTHER_USER, full_name: 'RT User' } },
  })
  const sp = await request.post('/api/set_password', { headers, data: { user: OTHER_USER, password: OTHER_PWD } })
  if (sp.status() !== 200) throw new Error(`set_password: ${sp.status()}`)
  // Clear rt-user's notifications so the unread badge starts empty each run.
  const notifs = (await (
    await request.get(
      `/api/table/Notification%20Log?filters=${encodeURIComponent(JSON.stringify([['for_user', '=', OTHER_USER]]))}&limit_page_length=200`,
      { headers },
    )
  ).json()) as { data: { row_id: string }[] }
  for (const n of notifs.data)
    await request.delete(`/api/table/Notification%20Log/${n.row_id}`, { headers })
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// Every test here drives TWO independent browser contexts, which the `session`
// fixture (bound to the default `page`) cannot reach — `createSession(page)`
// (the same factory `fixtures.ts`'s own DSL-backed `test` is built on) gives
// each context its own Session so both still go through Session verbs/steps
// rather than raw Playwright throughout.
test('RT-001: a doc created in one session appears in another session list', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  const sessionA = createSession(a)
  const sessionB = createSession(b)

  await sessionA.step('sign in as Administrator', () => loginAs(a, 'Administrator', ADMIN_PWD))
  await sessionB.step('sign in as Administrator', () => loginAs(b, 'Administrator', ADMIN_PWD))

  // Both watch the list; wait for B's list to render and its realtime
  // socket to connect+subscribe before A creates.
  await sessionA.visit(`/admin/${encodeURIComponent(DT)}`)
  await sessionB.visit(`/admin/${encodeURIComponent(DT)}`).assertHas('[data-testid="list-total"]')
  await sessionB.step('wait for the realtime subscription to the list channel', () => waitForRealtime(b, `list:${DT}`))
  const uniq = `rt-live-${Date.now()}`

  // A creates a doc via the API (its own session); B's list should update
  // with no reload.
  const token = await a.evaluate(() => localStorage.getItem('fc_token'))
  const res = await a.request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { row_id: uniq, title: uniq },
  })
  expect(res.status()).toBe(201)

  await sessionB.step('the list updates with no reload', async ({ page }) => {
    await expect(page.getByTestId('list-rows')).toContainText(uniq, { timeout: 10_000 })
  })
  await ctxA.close()
  await ctxB.close()
})

test('RT-002: saving a doc in one session shows a refresh banner in another', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  const sessionA = createSession(a)
  const sessionB = createSession(b)
  await sessionA.step('sign in as Administrator', () => loginAs(a, 'Administrator', ADMIN_PWD))
  await sessionB.step('sign in as Administrator', () => loginAs(b, 'Administrator', ADMIN_PWD))

  // Seed a doc and open it in both.
  const tokenA = await a.evaluate(() => localStorage.getItem('fc_token'))
  const docName = `rt-doc-${Date.now()}`
  await a.request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { row_id: docName, title: 'before' },
  })
  await sessionA.visit(`/admin/${encodeURIComponent(DT)}/${docName}`).assertHas('[data-testid="form-view"]')
  await sessionB.visit(`/admin/${encodeURIComponent(DT)}/${docName}`).assertHas('[data-testid="form-view"]')
  // No banner initially.
  await sessionB.refuteHas('[data-testid="stale-banner"]')
  // B's subscription to the row channel must be live before A saves,
  // otherwise the event is published to nobody.
  await sessionB.step('wait for the realtime subscription to the row channel', () => waitForRealtime(b, `row:${DT}:${docName}`))

  // A edits + saves; B gets the refresh banner without reloading.
  await sessionA.step('edit and save the title', async ({ page }) => {
    await page.locator('[data-field=title]').fill('after')
    await page.getByTestId('form-save').click()
    await expect(page.getByTestId('form-banner')).toContainText('Saved')
  })

  await sessionB.step('gets the refresh banner without reloading', async ({ page }) => {
    await expect(page.getByTestId('stale-banner')).toBeVisible({ timeout: 10_000 })
  })
  // A (the saver) does NOT see a stale banner for its own save.
  await sessionA.refuteHas('[data-testid="stale-banner"]')

  // Refreshing pulls the new value.
  await sessionB.step('refreshing pulls the new value', async ({ page }) => {
    await page.getByTestId('stale-refresh').click()
    await expect(page.locator('[data-field=title]')).toHaveValue('after')
  })
  await ctxA.close()
  await ctxB.close()
})

test('RT-003: an @mention pops the mentioned user unread count live', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  const sessionA = createSession(a)
  const sessionB = createSession(b)

  await sessionA.step('sign in as Administrator', () => loginAs(a, 'Administrator', ADMIN_PWD))
  await sessionB.step('sign in as the other user', () => loginAs(b, OTHER_USER, OTHER_PWD))

  // B sits in the Admin; wait for its personal channel to be live.
  await sessionB.visit('/admin').assertHas('[data-testid="session-user"]')
  await sessionB.step('wait for the realtime subscription to the personal channel', () => waitForRealtime(b, `user:${OTHER_USER}`))
  const startCount = await b.getByTestId('unread-count').count() // 0 badge if none

  const tokenA = await a.evaluate(() => localStorage.getItem('fc_token'))
  const docName = `rt-mention-${Date.now()}`
  await a.request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { row_id: docName, title: 'discuss' },
  })
  await sessionA.visit(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await sessionA.step('post a comment mentioning the other user', async ({ page }) => {
    // Trailing space closes the @mention autocomplete so it doesn't overlay
    // the submit button.
    await page.getByTestId('comment-input').fill(`ping @${OTHER_USER} `)
    await expect(page.getByTestId('mention-list')).toHaveCount(0)
    await page.getByTestId('comment-submit').click()
  })

  // B's unread badge appears/increments without a reload.
  await sessionB.step('the unread badge appears/increments without a reload', async ({ page }) => {
    await expect(page.getByTestId('unread-count')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('unread-count')).toHaveText(/[1-9]/)
  })
  expect(startCount).toBe(0)
  await ctxA.close()
  await ctxB.close()
})
