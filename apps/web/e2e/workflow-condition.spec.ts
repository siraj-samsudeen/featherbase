import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Wf Cond Ui Task'
const FLOW = 'Wf Cond Ui Flow'
const BIG = `wfc-big-${Math.random().toString(36).slice(2, 7)}`
const SMALL = `wfc-small-${Math.random().toString(36).slice(2, 7)}`

async function headers(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const H = await headers(request)
  const dt = await request.post('/api/doctype', {
    headers: H,
    data: {
      name: DT,
      autoname: 'prompt',
      fields: [
        { fieldname: 'title', fieldtype: 'Data', in_list_view: true },
        { fieldname: 'amount', fieldtype: 'Int', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.post('/api/save_doc', { headers: H, data: { doctype: 'Role', doc: { name: 'Wf Cond Approver' } } })

  await request.delete(`/api/resource/Workflow/${encodeURIComponent(FLOW)}`, { headers: H })
  const wf = await request.post('/api/save_doc', {
    headers: H,
    data: {
      doctype: 'Workflow',
      doc: {
        name: FLOW,
        document_type: DT,
        is_active: true,
        states: [
          { state: 'Draft', doc_status: '0' },
          { state: 'Approved', doc_status: '1' },
          { state: 'Auto Approved', doc_status: '1' },
        ],
        transitions: [
          { state: 'Draft', action: 'Approve', next_state: 'Approved', allowed: 'Wf Cond Approver', condition: 'doc.amount > 1000' },
          { state: 'Draft', action: 'Auto Approve', next_state: 'Auto Approved', allowed: 'Wf Cond Approver', condition: 'doc.amount <= 1000' },
        ],
      },
    },
  })
  if (![200, 201].includes(wf.status())) throw new Error(`workflow: ${wf.status()}`)

  await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers: H, data: { name: BIG, title: 'big', amount: 5000 } })
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers: H, data: { name: SMALL, title: 'small', amount: 500 } })
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

test('conditional transitions: the form shows only the action whose condition holds', async ({ page }) => {
  await login(page)

  // Big document (amount 5000): only "Approve" is offered.
  await page.goto(`/desk/${encodeURIComponent(DT)}/${BIG}`)
  await expect(page.getByTestId('workflow-actions')).toBeVisible()
  await expect(page.getByTestId('workflow-action-Approve')).toBeVisible()
  await expect(page.getByTestId('workflow-action-Auto Approve')).toHaveCount(0)

  // Small document (amount 500): only "Auto Approve" is offered.
  await page.goto(`/desk/${encodeURIComponent(DT)}/${SMALL}`)
  await expect(page.getByTestId('workflow-action-Auto Approve')).toBeVisible()
  await expect(page.getByTestId('workflow-action-Approve')).toHaveCount(0)

  // Applying the offered action moves the state.
  await page.getByTestId('workflow-action-Auto Approve').click()
  await expect(page.getByTestId('workflow-state')).toHaveText('Auto Approved')
})

test('the workflow builder grid exposes the Condition column', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/Workflow/${encodeURIComponent(FLOW)}`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  // The transitions child grid renders an editable Condition column carrying
  // our expressions — this IS the workflow builder (Frappe-style).
  const grid = page.getByTestId('table-transitions')
  await expect(grid.getByRole('columnheader', { name: 'Condition' })).toBeVisible()
  const conditionInputs = grid.locator('input[data-childfield="condition"]')
  await expect(conditionInputs).toHaveCount(2)
  await expect(conditionInputs.nth(0)).toHaveValue('doc.amount > 1000')
  await expect(conditionInputs.nth(1)).toHaveValue('doc.amount <= 1000')
})
