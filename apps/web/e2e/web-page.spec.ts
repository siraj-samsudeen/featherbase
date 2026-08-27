import { anonymousTest as test, expect, adminAuth, type Page } from './fixtures'

const ROUTE = 'about-e2e'

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  await request.delete('/api/table/Web%20Page/about-e2e-doc', { headers })
  const res = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Web Page',
      row: {
        row_id: 'about-e2e-doc',
        title: 'About E2E',
        route: ROUTE,
        content: '<h1>About This Company</h1><p id="tagline">We ship features.</p>',
        published: true,
      },
    },
  })
  if (res.status() !== 201) throw new Error(`create web page: ${res.status()} ${await res.text()}`)
})

// WEB-001: a published Web Page is publicly reachable and rendered without login.
test('WEB-001: a published Web Page renders publicly without a session', async ({ page, context }) => {
  // Ensure there is genuinely no session.
  await context.clearCookies()
  await page.goto(`/web/${ROUTE}`)

  await expect(page.getByTestId('web-page')).toBeVisible()
  await expect(page.locator('h1')).toHaveText('About This Company')
  await expect(page.locator('#tagline')).toHaveText('We ship features.')
  // We were never redirected to login.
  await expect(page).toHaveURL(new RegExp(`/web/${ROUTE}$`))
})

// WEB-001: an unpublished Web Page is not reachable.
test('WEB-001: an unpublished Web Page is not served', async ({ page, request }) => {
  const headers = await adminAuth(request)
  await request.delete('/api/table/Web%20Page/draft-e2e-doc', { headers })
  await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Web Page',
      row: { row_id: 'draft-e2e-doc', title: 'Draft', route: 'draft-e2e', content: '<p>hidden</p>', published: false },
    },
  })
  const res = await request.get('/web/draft-e2e')
  expect(res.status()).toBe(404)
  await page.goto('/web/draft-e2e')
  await expect(page.locator('body')).not.toContainText('hidden')
})
