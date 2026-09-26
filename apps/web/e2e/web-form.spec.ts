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
        { column_name: 'full_name', label: 'Full name', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'message', label: 'Message', column_type: 'Long Text', reqd: true },
        {
          column_name: 'delivery_speed',
          label: 'Delivery speed',
          column_type: 'Choice',
          choices: 'Standard\nExpedited\nSame day',
          reqd: true,
        },
        {
          column_name: 'contact_method',
          label: 'Contact method',
          column_type: 'Choice',
          choices: 'Email\nPhone',
        },
        {
          column_name: 'quantity_code',
          label: 'Quantity code',
          column_type: 'Choice',
          choices: '0\n1\n2',
          reqd: true,
        },
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
        web_fields: [
          'full_name',
          'message',
          'delivery_speed',
          'contact_method',
          'quantity_code',
        ],
        published: true,
      },
    },
  })
  if (wf.status() !== 201) throw new Error(`web form: ${wf.status()} ${await wf.text()}`)
})

// WEB-002: an anonymous visitor submits a public web form and it creates a doc;
// server validation still applies.
//
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// `context.clearCookies()` is a raw Playwright fixture with no DSL verb. The
// rendered controls are labelled, so every supported form interaction uses a
// Session verb.
test('WEB-002: anonymous web form submit creates a document', async ({ session, context, request }) => {
  await session.step('clear cookies so there is genuinely no session', async () => {
    await context.clearCookies()
  })
  const unique = `E2E ${Date.now()}`
  await session
    .visit(`/form/${ROUTE}`)
    .assertOptions('Delivery speed *', ['—', 'Standard', 'Expedited', 'Same day'])
    .assertOptions('Contact method', ['—', 'Email', 'Phone'])
    .assertOptions('Quantity code *', ['—', '0', '1', '2'])

  await session.step('the form title renders exactly', async ({ page }) => {
    await expect(page.getByTestId('web-form-title')).toHaveText('Contact E2E')
  })

  await session
    .fillIn('Full name *', unique)
    .clickButton('Submit')
    .assertHas('[data-testid="web-form-submit-error"]')

  await session
    .fillIn('Message *', 'Hello from the public web form')
    .selectOption('Delivery speed *', 'Expedited')
    .assertSelected('Delivery speed *', 'Expedited')
    .selectOption('Quantity code *', '1')
    .assertSelected('Quantity code *', '1')
    .clickButton('Submit')
    .assertHas('[data-testid="web-form-success"]')

  // Both selected required choices are persisted as their exact strings,
  // while the optional choice can stay on its placeholder and remains empty.
  const headers = await adminAuth(request)
  const filters = encodeURIComponent(JSON.stringify([['full_name', '=', unique]]))
  const list = (await (
    await request.get(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
        '["delivery_speed","contact_method","quantity_code"]',
      )}&filters=${filters}`,
      { headers },
    )
  ).json()) as {
    total: number
    data: { delivery_speed: string; contact_method: string | null; quantity_code: string }[]
  }
  expect(list.total).toBe(1)
  expect(list.data).toEqual([
    { delivery_speed: 'Expedited', contact_method: null, quantity_code: '1' },
  ])
})
