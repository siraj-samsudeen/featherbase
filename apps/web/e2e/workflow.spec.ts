import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Wf Ui Task'

// WF-002: a user with the right role sees the transition button and the
// state changes; the audit trail records who/when.

// A submitted (docstatus=1) doc can't be deleted via the API, so each run
// uses a fresh document name instead of reusing one.
const DOC = `wf-ui-${Math.random().toString(36).slice(2, 8)}`

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }

  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, autoname: 'prompt', fields: [{ fieldname: 'title', fieldtype: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)

  await request.post('/api/save_doc', { headers, data: { doctype: 'Role', doc: { name: 'Wf Ui Approver' } } })

  // Fresh workflow each run (delete old first so states/transitions are clean).
  await request.delete('/api/resource/Workflow/Wf%20Ui%20Flow', { headers })
  const wf = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Workflow',
      doc: {
        name: 'Wf Ui Flow',
        document_type: DT,
        is_active: true,
        states: [
          { state: 'Draft', doc_status: '0' },
          { state: 'Approved', doc_status: '1' },
        ],
        transitions: [{ state: 'Draft', action: 'Approve', next_state: 'Approved', allowed: 'Wf Ui Approver' }],
      },
    },
  })
  if (![201, 200].includes(wf.status())) throw new Error(`workflow: ${wf.status()}`)

  
  const doc = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers,
    data: { name: DOC, title: 'Approve me' },
  })
  if (doc.status() !== 201) throw new Error(`doc: ${doc.status()}`)
})

test('WF-002: Approve button transitions state and records the audit trail', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT)}/${DOC}`)

  // Current state shown, Approve action available (admin sees all).
  await expect(page.getByTestId('workflow-state')).toHaveText('Draft')
  const approve = page.getByTestId('workflow-action-Approve')
  await expect(approve).toBeVisible()
  await approve.click()

  // State flips to Approved.
  await expect(page.getByTestId('workflow-state')).toHaveText('Approved')
  await expect(page.getByTestId('workflow-action-Approve')).toHaveCount(0)

  // Audit trail persisted (who/what).
  const token = await page.evaluate(() => localStorage.getItem('fc_token'))
  const filters = encodeURIComponent(JSON.stringify([['ref_name', '=', DOC]]))
  const fields = encodeURIComponent(JSON.stringify(['action', 'to_state', 'actor']))
  const trail = (await (
    await page.request.get(`/api/resource/Workflow%20Action?filters=${filters}&fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { data: { action: string; to_state: string; actor: string }[] }
  expect(trail.data.length).toBeGreaterThanOrEqual(1)
  expect(trail.data[0].action).toBe('Approve')
  expect(trail.data[0].to_state).toBe('Approved')
  expect(trail.data[0].actor).toBe('Administrator')
})
