import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Cmt DT'

// UI-018: threaded comment box on every document with @mentions.

async function auth(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

let docName = ''

test.beforeAll(async ({ request }) => {
  const headers = await auth(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, autoname: 'prompt', fields: [{ fieldname: 'title', fieldtype: 'Data' }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  docName = 'cmt-doc-1'
  await request.delete(`/api/resource/${encodeURIComponent(DT)}/${docName}`, { headers })
  // clear any prior comments
  const filters = encodeURIComponent(
    JSON.stringify([
      ['ref_doctype', '=', DT],
      ['ref_name', '=', docName],
    ]),
  )
  const prior = (await (
    await request.get(`/api/resource/Comment?filters=${filters}`, { headers })
  ).json()) as { data: { name: string }[] }
  for (const c of prior.data)
    await request.delete(`/api/resource/Comment/${c.name}`, { headers })
  const doc = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers,
    data: { name: docName, title: 'discuss me' },
  })
  if (doc.status() !== 201) throw new Error(`doc: ${doc.status()}`)
})

test('UI-018: post comments with an @mention; they persist and render', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('comments-panel')).toContainText('No comments yet')

  // Plain comment.
  await page.getByTestId('comment-input').fill('First observation')
  await page.getByTestId('comment-submit').click()
  await expect(page.getByTestId('comment-item')).toHaveCount(1)
  await expect(page.getByTestId('comment-content').first()).toContainText('First observation')

  // @mention autocomplete: typing '@Admin' surfaces Administrator.
  await page.getByTestId('comment-input').fill('cc @Admin')
  const opt = page.getByTestId('mention-option').filter({ hasText: 'Administrator' })
  await expect(opt).toBeVisible()
  await opt.click()
  await expect(page.getByTestId('comment-input')).toHaveValue('cc @Administrator ')
  await page.getByTestId('comment-input').press('End')
  await page.getByTestId('comment-input').pressSequentially('please review')
  await page.getByTestId('comment-submit').click()
  await expect(page.getByTestId('comment-item')).toHaveCount(2)

  // The mention renders highlighted (its own span).
  const second = page.getByTestId('comment-content').nth(1)
  await expect(second.locator('span.text-\\[var\\(--color-brand\\)\\]')).toContainText(
    '@Administrator',
  )

  // Comments survive reload (persisted server-side).
  await page.reload()
  await expect(page.getByTestId('comment-item')).toHaveCount(2)

  // Verify via API too.
  const token = await page.evaluate(() => localStorage.getItem('fc_token'))
  const filters = encodeURIComponent(
    JSON.stringify([
      ['ref_doctype', '=', DT],
      ['ref_name', '=', docName],
    ]),
  )
  const listed = (await (
    await page.request.get(
      `/api/resource/Comment?filters=${filters}&fields=${encodeURIComponent(
        JSON.stringify(['name', 'content']),
      )}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  ).json()) as { data: { content: string }[] }
  expect(listed.data.length).toBe(2)
  expect(listed.data.some((c) => c.content.includes('@Administrator'))).toBe(true)

  // The @mention created a Notification Log row for the mentioned user.
  const notifFilters = encodeURIComponent(
    JSON.stringify([
      ['for_user', '=', 'Administrator'],
      ['ref_doctype', '=', DT],
      ['ref_name', '=', docName],
    ]),
  )
  const notifs = (await (
    await page.request.get(
      `/api/resource/Notification%20Log?filters=${notifFilters}&fields=${encodeURIComponent(
        JSON.stringify(['subject', 'read']),
      )}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  ).json()) as { data: { subject: string; read: boolean }[] }
  expect(notifs.data.length).toBeGreaterThanOrEqual(1)
  expect(notifs.data[0].subject).toContain('mentioned you')
})
