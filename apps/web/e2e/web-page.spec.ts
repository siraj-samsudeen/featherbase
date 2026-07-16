import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const ROUTE = 'about-e2e'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  await request.delete('/api/resource/Web%20Page/about-e2e-doc', { headers })
  const res = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Web Page',
      doc: {
        name: 'about-e2e-doc',
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
  const headers = await adminHeaders(request)
  await request.delete('/api/resource/Web%20Page/draft-e2e-doc', { headers })
  await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Web Page',
      doc: { name: 'draft-e2e-doc', title: 'Draft', route: 'draft-e2e', content: '<p>hidden</p>', published: false },
    },
  })
  const res = await request.get('/web/draft-e2e')
  expect(res.status()).toBe(404)
  await page.goto('/web/draft-e2e')
  await expect(page.locator('body')).not.toContainText('hidden')
})
