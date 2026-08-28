import { anonymousTest as test, expect, adminAuth } from './fixtures'

const DT = 'WF E2E Msg'
const ROUTE = 'contact-e2e'

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'full_name', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'message', column_type: 'Long Text', reqd: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  await request.delete('/api/table/Web%20Form/wf-e2e', { headers })
  const wf = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Web Form',
      row: {
        row_id: 'wf-e2e',
        title: 'Contact E2E',
        route: ROUTE,
        ref_table: DT,
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
  const headers = await adminAuth(request)
  const filters = encodeURIComponent(JSON.stringify([['full_name', '=', unique]]))
  const list = (await (
    await request.get(`/api/table/${encodeURIComponent(DT)}?filters=${filters}`, { headers })
  ).json()) as { total: number }
  expect(list.total).toBe(1)
})
