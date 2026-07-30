import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const SUBJECT = 'E2E: helpdesk renders in the generic Desk'

async function token(request: APIRequestContext) {
  const r = await request.post('/api/login', {
    data: { usr: 'Administrator', pwd: ADMIN_PWD },
  })
  return ((await r.json()) as { token: string }).token
}

// The Helpdesk structure is opt-in now (#74 — it no longer ships in the
// migration chain), so the spec installs the slice it exercises — the three
// roles, the HD Ticket Table, and the status-field workflow — through the
// public API, exactly as a user would build an app. Idempotent: a database
// that already carries the structure (seed-helpdesk.ts, or a previous run —
// there is no DELETE /api/doctype yet, see #66) is left as-is.
async function ensureHelpdeskStructure(request: APIRequestContext) {
  const H = { Authorization: `Bearer ${await token(request)}` }
  const has = await request.get('/api/table/HD%20Ticket:meta', { headers: H })
  if (has.ok()) return

  for (const role of ['Support Agent', 'Support Manager', 'Customer']) {
    const r = await request.get(`/api/resource/Role/${encodeURIComponent(role)}`, { headers: H })
    if (r.ok()) continue
    const made = await request.post('/api/save_doc', {
      headers: H,
      data: { doctype: 'Role', doc: { name: role } },
    })
    if (made.status() !== 201) throw new Error(`seed role ${role}: ${made.status()} ${await made.text()}`)
  }

  const dt = await request.post('/api/doctype', {
    headers: H,
    data: {
      name: 'HD Ticket',
      module: 'Helpdesk',
      id_pattern: 'HDT-.#####',
      title_column: 'subject',
      columns: [
        { column_name: 'subject', label: 'Subject', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'description', label: 'Description', column_type: 'Text' },
        {
          column_name: 'ticket_status', label: 'Status', column_type: 'Choice', in_list_view: true,
          choices: 'Open\nIn Progress\nResolved\nClosed', default_value: 'Open',
        },
        {
          column_name: 'priority', label: 'Priority', column_type: 'Choice', in_list_view: true,
          choices: 'Low\nMedium\nHigh\nUrgent', default_value: 'Medium',
        },
        { column_name: 'raised_by', label: 'Raised By (email)', column_type: 'Data' },
      ],
    },
  })
  if (dt.status() !== 201) throw new Error(`seed HD Ticket: ${dt.status()} ${await dt.text()}`)

  const wf = await request.post('/api/save_doc', {
    headers: H,
    data: {
      doctype: 'Workflow',
      doc: {
        name: 'HD Ticket Flow',
        ref_table: 'HD Ticket',
        is_active: true,
        state_field: 'ticket_status',
        states: [
          { state: 'Open', target_status: 'draft' },
          { state: 'In Progress', target_status: 'draft' },
          { state: 'Resolved', target_status: 'draft' },
          { state: 'Closed', target_status: 'draft' },
        ],
        transitions: [
          { state: 'Open', action: 'Start', next_state: 'In Progress', allowed: 'Support Agent' },
          { state: 'In Progress', action: 'Resolve', next_state: 'Resolved', allowed: 'Support Agent' },
          { state: 'Resolved', action: 'Close', next_state: 'Closed', allowed: 'Support Manager' },
        ],
      },
    },
  })
  if (wf.status() !== 201) throw new Error(`seed workflow: ${wf.status()} ${await wf.text()}`)
}

let name = ''

// Helpdesk sample app: the generic Desk renders the HD Ticket Table — list,
// form, and workflow actions on the bound status field — with zero bespoke
// frontend. The spec seeds its own ticket (demo content is opt-in) and
// removes it afterwards so no ticket outlives the run.
test.beforeAll(async ({ request }) => {
  await ensureHelpdeskStructure(request)
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
  await request.delete(`/api/table/HD%20Ticket/${name}`, { headers: H })
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
