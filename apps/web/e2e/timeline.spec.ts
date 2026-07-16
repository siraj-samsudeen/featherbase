import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Tl DT'

// UI-019: after an edit and a comment, the timeline shows both in order with
// the diff summary.

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      autoname: 'prompt',
      fields: [{ fieldname: 'title', fieldtype: 'Data', in_list_view: true }],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  docName = 'tl-doc'
  await request.delete(`/api/resource/${encodeURIComponent(DT)}/${docName}`, { headers })
  const doc = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers,
    data: { name: docName, title: 'original' },
  })
  if (doc.status() !== 201) throw new Error(`doc: ${doc.status()}`)
})

test('UI-019: timeline interleaves an edit (with diff) and a comment in order', async ({
  page,
}) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('activity-timeline')).toBeVisible()

  // Edit the title → produces a version with a diff.
  await page.locator('[data-field=title]').fill('revised title')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
  await expect(page.getByTestId('activity-version')).toHaveCount(1)
  await expect(page.getByTestId('activity-diff')).toContainText('title')
  await expect(page.getByTestId('activity-diff')).toContainText('original')
  await expect(page.getByTestId('activity-diff')).toContainText('revised title')

  // Post a comment → appears after the edit (later timestamp).
  await page.getByTestId('comment-input').fill('looks good now')
  await page.getByTestId('comment-submit').click()
  await expect(page.getByTestId('activity-comment')).toHaveCount(1)

  // Both present, in chronological order (version before comment).
  const kinds = await page
    .getByTestId('activity-timeline')
    .locator('[data-testid^="activity-version"], [data-testid^="activity-comment"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(kinds).toEqual(['activity-version', 'activity-comment'])
})
