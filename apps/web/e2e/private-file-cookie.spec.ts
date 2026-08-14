import { expect, test, type APIRequestContext } from '@playwright/test'

// #173: a private file link must carry no credential. The browser is already
// sending the HttpOnly `sid` cookie on a same-origin request, so the link is
// the bare file URL — and it still serves.
//
// Uploads made through the Admin UI are public, so the private path has no
// other browser coverage: this spec creates the private file over the API and
// then exercises the link the form renders for it.

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const SECRET = 'classified attachment body'

async function adminToken(request: APIRequestContext): Promise<string> {
  const login = await request.post('/api/login', {
    data: { usr: 'Administrator', pwd: ADMIN_PWD },
  })
  return ((await login.json()) as { token: string }).token
}

async function cleanup(request: APIRequestContext) {
  const auth = { Authorization: `Bearer ${await adminToken(request)}` }
  const filters = encodeURIComponent(
    JSON.stringify([
      ['ref_table', '=', 'User'],
      ['ref_name', '=', 'Guest'],
    ]),
  )
  const listed = (await (
    await request.get(`/api/table/File?filters=${filters}`, { headers: auth })
  ).json()) as { data: { row_id: string }[] }
  for (const f of listed.data) await request.delete(`/api/table/File/${f.row_id}`, { headers: auth })
}

test.beforeEach(async ({ request }) => cleanup(request))
test.afterEach(async ({ request }) => cleanup(request))

test('#173: a private attachment links without a token and serves on the cookie', async ({
  page,
  request,
}) => {
  const uploaded = await request.post('/api/upload_file', {
    headers: { Authorization: `Bearer ${await adminToken(request)}` },
    multipart: {
      file: { name: 'secret.txt', mimeType: 'text/plain', buffer: Buffer.from(SECRET) },
      is_private: '1',
      ref_table: 'User',
      ref_name: 'Guest',
    },
  })
  const { file_url } = (await uploaded.json()) as { file_url: string }
  expect(file_url).toMatch(/^\/private\/files\//)

  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)

  await page.goto('/admin/User/Guest')
  const row = page.getByTestId('attachment-row').filter({ hasText: 'secret.txt' })
  const href = await row.locator('a').getAttribute('href')

  // The regression this pins: the link used to be `${file_url}?token=<7-day
  // session JWT>`, which lands in history, `Referer` and proxy logs.
  expect(href).toBe(file_url)
  expect(href).not.toContain('token=')

  // And it still opens — a real browser navigation, credential-free URL, the
  // cookie doing the authenticating.
  const served = await page.goto(href!)
  expect(served?.status()).toBe(200)
  expect(await page.locator('body').innerText()).toContain(SECRET)
})
