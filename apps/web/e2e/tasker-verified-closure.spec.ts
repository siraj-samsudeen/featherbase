import { test, expect, ensureRuntimeApp, admitTaskerAdmin, adminAuth, tokenFor, bearer, type APIRequestContext } from './fixtures'

const PASSWORD = 'tasker-verify-e2e'
const SUBMITTED = 'Submitted for verification'

test.beforeAll(async ({ request }) => {
  await ensureRuntimeApp(request, 'tasker')
  await admitTaskerAdmin(request)
})

/** A Tasker member who signs in through the API, as the person doing the work. */
async function member(request: APIRequestContext, versionHeader: string) {
  const headers = await adminAuth(request)
  const email = `ravi.${Date.now()}@example.com`
  const made = await request.post('/api/save_row', {
    headers, data: { table: 'Person', row: { email, full_name: 'Ravi', enabled: true, roles: [{ role: 'Tasker Member' }] } },
  })
  if (made.status() !== 201) throw new Error(`create person: ${made.status()} ${await made.text()}`)
  const { row_id } = await made.json() as { row_id: string }
  const set = await request.post('/api/set_password', { headers, data: { user: row_id, password: PASSWORD } })
  if (!set.ok()) throw new Error(`set password: ${set.status()}`)
  return { id: row_id, headers: { ...bearer(await tokenFor(request, email, PASSWORD)), 'X-Featherbase-App-Version': versionHeader } }
}

test('tasker_verified_closure: the doer submits, the verifier returns it with a reason, then accepts the second submission', async ({ session, request }) => {
  const admin = await ensureRuntimeApp(request, 'tasker')
  const ravi = await member(request, admin['X-Featherbase-App-Version'])
  const save = async (headers: Record<string, string>, row: Record<string, unknown>, table = 'tasker.task') => {
    const response = await request.post('/api/save_row', { headers, data: { table, row } })
    expect(response.status(), await response.text()).toBe(201)
    return await response.json() as { row_id: string; updated_at: string }
  }
  const title = `Fix the billing counter lights ${Date.now()}`
  const project = await save(admin, { project_name: `Diwali readiness ${Date.now()}` }, 'tasker.project')
  const task = await save(admin, { task_title: title, project: project.row_id, assigned_to: ravi.id, verifier: 'Administrator' })
  const acknowledged = await save(ravi.headers, { row_id: task.row_id, updated_at: task.updated_at, acknowledged_at: new Date().toISOString() })
  await save(ravi.headers, { row_id: task.row_id, updated_at: acknowledged.updated_at, task_state: SUBMITTED, evidence_note: 'Replaced both tube lights' })

  await session
    .visit('/tasker/')
    .within('.tasker-nav-verify', tab => tab.click('To verify'))
    .within('section[aria-labelledby="verify-heading"]', list => list
      .assertText('Replaced both tube lights')
      .click(title))

  await session.step('the verifier returns it with a reason', async ({ page }) => {
    const detail = page.getByRole('region', { name: 'Task detail content' })
    await detail.getByRole('button', { name: 'Return', exact: true }).click()
    await detail.getByRole('textbox', { name: 'Reason for returning' }).fill('Left counter still flickers')
    await detail.getByRole('button', { name: 'Return task' }).click()
    await expect(detail.getByText('Returned: Left counter still flickers')).toBeVisible()
  })

  const returned = await (await request.get(`/api/table/tasker.task/${task.row_id}`, { headers: ravi.headers })).json() as { updated_at: string; return_count: number }
  expect(returned.return_count).toBe(1)
  await save(ravi.headers, { row_id: task.row_id, updated_at: returned.updated_at, task_state: SUBMITTED, evidence_note: 'Replaced the starter too' })

  await session.step('the verifier accepts the second submission', async ({ page }) => {
    await page.goto('/tasker/')
    await page.locator('.tasker-nav-verify').click()
    await page.getByRole('region', { name: 'To verify' }).getByRole('link', { name: title }).click()
    const detail = page.getByRole('region', { name: 'Task detail content' })
    await expect(detail.locator('.tasker-evidence-note')).toHaveText('Replaced the starter too')
    await detail.getByRole('button', { name: 'Accept and close' }).click()
    await expect(detail.getByText(/^Verified by Administrator/)).toBeVisible()
  })
})
