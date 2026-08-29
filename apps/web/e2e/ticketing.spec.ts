import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const SUBJECT = 'E2E: helpdesk renders in the generic Admin'

// The Helpdesk is a registered installable app now (PLAT-006, #78), so the
// spec installs it through the real endpoint — POST /api/install_app
// { name: 'helpdesk' } — exactly as a deployment would. Idempotent: a
// database that already carries the structure (seed-helpdesk.ts, or a
// previous run) is left as-is; a later `POST /api/uninstall_app` can remove
// the footprint wholesale.
async function ensureHelpdeskStructure(request: APIRequestContext) {
  const H = await adminAuth(request)
  const has = await request.get('/api/table/HD%20Ticket:meta', { headers: H })
  if (has.ok()) return

  const r = await request.post('/api/install_app', {
    headers: H,
    data: { name: 'helpdesk' },
  })
  if (r.status() !== 201) throw new Error(`install helpdesk: ${r.status()} ${await r.text()}`)
}

let name = ''

// Helpdesk sample app: the generic Admin renders the HD Ticket Table — list,
// form, and workflow actions on the bound status field — with zero bespoke
// frontend. The spec seeds its own ticket (demo content is opt-in) and
// removes it afterwards so no ticket outlives the run.
test.beforeAll(async ({ request }) => {
  await ensureHelpdeskStructure(request)
  const H = await adminAuth(request)
  const r = await request.post('/api/save_row', {
    headers: H,
    data: { table: 'HD Ticket', row: { subject: SUBJECT } },
  })
  if (r.status() !== 201) throw new Error(`seed ticket: ${r.status()} ${await r.text()}`)
  name = ((await r.json()) as { row_id: string }).row_id
})

test.afterAll(async ({ request }) => {
  if (!name) return
  const H = await adminAuth(request)
  await request.delete(`/api/table/HD%20Ticket/${name}`, { headers: H })
})

test('helpdesk: a ticket renders in the Admin and opens with workflow actions', async ({
  page,
}) => {
  await page.goto('/admin/HD%20Ticket')
  await expect(page.getByText(name)).toBeVisible()
  await expect(page.getByText(SUBJECT)).toBeVisible()

  await page.getByText(name).click()
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.getByTestId('workflow-actions')).toContainText('Open')
  await expect(page.getByTestId('workflow-action-Start')).toBeVisible()
})
