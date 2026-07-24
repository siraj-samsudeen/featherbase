import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const SUBJECT = 'E2E: helpdesk renders in the generic Desk'

async function token(request: APIRequestContext) {
  const r = await request.post('/api/login', {
    data: { usr: 'Administrator', pwd: ADMIN_PWD },
  })
  return ((await r.json()) as { token: string }).token
}

let name = ''

// Helpdesk demo app (migration 0051): the generic Desk renders the HD Ticket
// DocType — list, form, and workflow actions on the bound status field —
// with zero bespoke frontend. The spec seeds its own ticket (demo content is
// opt-in) and removes it afterwards so nothing outlives the run.
test.beforeAll(async ({ request }) => {
  const H = { Authorization: `Bearer ${await token(request)}` }
  const r = await request.post('/api/save_doc', {
    headers: H,
    data: { doctype: 'HD Ticket', doc: { subject: SUBJECT } },
  })
  if (r.status() !== 201) throw new Error(`seed ticket: ${r.status()} ${await r.text()}`)
  name = ((await r.json()) as { name: string }).name
})

test.afterAll(async ({ request }) => {
  if (!name) return
  const H = { Authorization: `Bearer ${await token(request)}` }
  await request.delete(`/api/resource/HD%20Ticket/${name}`, { headers: H })
})

test('helpdesk: a ticket renders in the Desk and opens with workflow actions', async ({
  page,
}) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/desk/)

  await page.goto('/desk/HD%20Ticket')
  await expect(page.getByText(name)).toBeVisible()
  await expect(page.getByText(SUBJECT)).toBeVisible()

  await page.getByText(name).click()
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.getByTestId('workflow-actions')).toContainText('Open')
  await expect(page.getByTestId('workflow-action-Start')).toBeVisible()
})
