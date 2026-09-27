import { anonymousTest as test, expect, adminAuth } from './fixtures'

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

// WEB-001, migrated to the feather-testing-core DSL
// (docs/testing/e2e-dsl-migration.md). `context.clearCookies()` is a raw
// Playwright fixture the DSL has no verb for, so it opens a named step; the
// rendered content is plain text the DSL's own assertText/assertPath reach.
test('WEB-001: a published Web Page renders publicly without a session', async ({ session, context }) => {
  // Ensure there is genuinely no session.
  await session.step('clear cookies so there is genuinely no session', async () => {
    await context.clearCookies()
  })
  await session
    .visit(`/web/${ROUTE}`)
    .assertHas('[data-testid="web-page"]')
    .within('h1', (heading) => heading.assertExactText('About This Company'))
    .within('#tagline', (tagline) => tagline.assertExactText('We ship features.'))
    // We were never redirected to login.
    .assertPath(`/web/${ROUTE}`)
})

// WEB-001: an unpublished Web Page is not reachable.
test('WEB-001: an unpublished Web Page is not served', async ({ session, request }) => {
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
  await session.visit('/web/draft-e2e').refuteText('hidden')
})
