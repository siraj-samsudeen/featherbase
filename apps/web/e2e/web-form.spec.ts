import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'WF E2E Msg'
const ROUTE = 'contact-e2e'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      fields: [
        { fieldname: 'full_name', fieldtype: 'Data', reqd: true, in_list_view: true },
        { fieldname: 'message', fieldtype: 'Long Text', reqd: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.delete('/api/resource/Web%20Form/wf-e2e', { headers })
  const wf = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Web Form',
      doc: {
        name: 'wf-e2e',
        title: 'Contact E2E',
        route: ROUTE,
        document_type: DT,
        web_fields: ['full_name', 'message'],
        published: true,
      },
    },
  })
  if (wf.status() !== 201) throw new Error(`web form: ${wf.status()} ${await wf.text()}`)
})

// WEB-002: an anonymous visitor submits a public web form and it creates a doc;
// server validation still applies.
test('WEB-002: anonymous web form submit creates a document', async ({ page, context, request }) => {
  await context.clearCookies()
  const unique = `E2E ${Date.now()}`
  await page.goto(`/form/${ROUTE}`)
  await expect(page.getByTestId('web-form-title')).toHaveText('Contact E2E')

  // Submitting with a required field blank surfaces the server validation error.
  await page.getByTestId('wf-field-full_name').fill(unique)
  await page.getByTestId('web-form-submit').click()
  await expect(page.getByTestId('web-form-submit-error')).toBeVisible()

  // Filling everything creates the document.
  await page.getByTestId('wf-field-message').fill('Hello from the public web form')
  await page.getByTestId('web-form-submit').click()
  await expect(page.getByTestId('web-form-success')).toBeVisible()

  // The doc really exists (checked as admin).
  const headers = await adminHeaders(request)
  const filters = encodeURIComponent(JSON.stringify([['full_name', '=', unique]]))
  const list = (await (
    await request.get(`/api/resource/${encodeURIComponent(DT)}?filters=${filters}`, { headers })
  ).json()) as { total: number }
  expect(list.total).toBe(1)
})
