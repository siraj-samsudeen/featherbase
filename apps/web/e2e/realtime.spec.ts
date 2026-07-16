import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Rt DT'
const OTHER_USER = 'rt-user@x.com'
const OTHER_PWD = 'rtpw12345'

async function adminAuth(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

async function loginAs(page: Page, email: string, pwd: string) {
  await page.goto('/login')
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', pwd)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, autoname: 'prompt', fields: [{ fieldname: 'title', fieldtype: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  // A second real user for the mention/notification test.
  await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'User', doc: { name: OTHER_USER, email: OTHER_USER, full_name: 'RT User' } },
  })
  const sp = await request.post('/api/set_password', { headers, data: { user: OTHER_USER, password: OTHER_PWD } })
  if (sp.status() !== 200) throw new Error(`set_password: ${sp.status()}`)
  // Clear rt-user's notifications so the unread badge starts empty each run.
  const notifs = (await (
    await request.get(
      `/api/resource/Notification%20Log?filters=${encodeURIComponent(JSON.stringify([['for_user', '=', OTHER_USER]]))}&limit_page_length=200`,
      { headers },
    )
  ).json()) as { data: { name: string }[] }
  for (const n of notifs.data)
    await request.delete(`/api/resource/Notification%20Log/${n.name}`, { headers })
})

test('RT-001: a doc created in one session appears in another session list', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()

  await loginAs(a, 'Administrator', ADMIN_PWD)
  await loginAs(b, 'Administrator', ADMIN_PWD)

  // Both watch the list; wait for B's list to render and its realtime
  // socket to connect+subscribe before A creates.
  await a.goto(`/desk/${encodeURIComponent(DT)}`)
  await b.goto(`/desk/${encodeURIComponent(DT)}`)
  await expect(b.getByTestId('list-total')).toBeVisible()
  await b.waitForTimeout(1000)
  const uniq = `rt-live-${Date.now()}`

  // A creates a doc via the API (its own session); B's list should update
  // with no reload.
  const token = await a.evaluate(() => localStorage.getItem('fc_token'))
  const res = await a.request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: uniq, title: uniq },
  })
  expect(res.status()).toBe(201)

  await expect(b.getByTestId('list-rows')).toContainText(uniq, { timeout: 10_000 })
  await ctxA.close()
  await ctxB.close()
})

test('RT-002: saving a doc in one session shows a refresh banner in another', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  await loginAs(a, 'Administrator', ADMIN_PWD)
  await loginAs(b, 'Administrator', ADMIN_PWD)

  // Seed a doc and open it in both.
  const tokenA = await a.evaluate(() => localStorage.getItem('fc_token'))
  const docName = `rt-doc-${Date.now()}`
  await a.request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { name: docName, title: 'before' },
  })
  await a.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await b.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await expect(a.getByTestId('form-view')).toBeVisible()
  await expect(b.getByTestId('form-view')).toBeVisible()
  // No banner initially.
  await expect(b.getByTestId('stale-banner')).toHaveCount(0)

  // A edits + saves; B gets the refresh banner without reloading.
  await a.locator('[data-field=title]').fill('after')
  await a.getByTestId('form-save').click()
  await expect(a.getByTestId('form-banner')).toContainText('Saved')

  await expect(b.getByTestId('stale-banner')).toBeVisible({ timeout: 10_000 })
  // A (the saver) does NOT see a stale banner for its own save.
  await expect(a.getByTestId('stale-banner')).toHaveCount(0)

  // Refreshing pulls the new value.
  await b.getByTestId('stale-refresh').click()
  await expect(b.locator('[data-field=title]')).toHaveValue('after')
  await ctxA.close()
  await ctxB.close()
})

test('RT-003: an @mention pops the mentioned user unread count live', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()

  await loginAs(a, 'Administrator', ADMIN_PWD)
  await loginAs(b, OTHER_USER, OTHER_PWD)

  // B sits in the Desk; wait for its realtime socket to connect.
  await b.goto('/desk')
  await expect(b.getByTestId('session-user')).toBeVisible()
  await b.waitForTimeout(1000)
  const startCount = await b.getByTestId('unread-count').count() // 0 badge if none

  const tokenA = await a.evaluate(() => localStorage.getItem('fc_token'))
  const docName = `rt-mention-${Date.now()}`
  await a.request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { name: docName, title: 'discuss' },
  })
  await a.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  // Trailing space closes the @mention autocomplete so it doesn't overlay
  // the submit button.
  await a.getByTestId('comment-input').fill(`ping @${OTHER_USER} `)
  await expect(a.getByTestId('mention-list')).toHaveCount(0)
  await a.getByTestId('comment-submit').click()

  // B's unread badge appears/increments without a reload.
  await expect(b.getByTestId('unread-count')).toBeVisible({ timeout: 10_000 })
  await expect(b.getByTestId('unread-count')).toHaveText(/[1-9]/)
  expect(startCount).toBe(0)
  await ctxA.close()
  await ctxB.close()
})
