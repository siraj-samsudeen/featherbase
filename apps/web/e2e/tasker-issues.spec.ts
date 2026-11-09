import { test, expect, ensureRuntimeApp, admitTaskerAdmin, adminAuth, tokenFor, bearer, type APIRequestContext } from './fixtures'

const PASSWORD = 'tasker-issue-e2e'

test.beforeAll(async ({ request }) => {
  await ensureRuntimeApp(request, 'tasker')
  await admitTaskerAdmin(request)
})

/** A Tasker member who signs in through the API and owns the issue. */
async function member(request: APIRequestContext, versionHeader: string) {
  const headers = await adminAuth(request)
  const email = `suresh.${Date.now()}@example.com`
  const made = await request.post('/api/save_row', {
    headers, data: { table: 'Person', row: { email, full_name: `Suresh ${Date.now()}`, enabled: true, roles: [{ role: 'Tasker Member' }] } },
  })
  if (made.status() !== 201) throw new Error(`create person: ${made.status()} ${await made.text()}`)
  const { row_id, full_name } = await made.json() as { row_id: string; full_name: string }
  const set = await request.post('/api/set_password', { headers, data: { user: row_id, password: PASSWORD } })
  if (!set.ok()) throw new Error(`set password: ${set.status()}`)
  return { id: row_id, name: full_name, headers: { ...bearer(await tokenFor(request, email, PASSWORD)), 'X-Featherbase-App-Version': versionHeader } }
}

test('tasker_issue_closure: an issue is raised in the UI, acknowledged and submitted by its owner, and accepted by the verifier', async ({ session, request }) => {
  const admin = await ensureRuntimeApp(request, 'tasker')
  const suresh = await member(request, admin['X-Featherbase-App-Version'])
  const title = `Dairy chiller 2 at 9°C ${Date.now()}`

  await session.visit('/tasker/')
  await session.step('raise the issue', async ({ page }) => {
    await page.locator('.tasker-nav-issues').click()
    await page.getByRole('button', { name: 'Raise an issue' }).click()
    const form = page.getByRole('form', { name: 'Raise an issue' })
    await form.getByRole('textbox', { name: 'What happened' }).fill(title)
    await form.getByRole('combobox', { name: 'Severity', exact: true }).selectOption('High')
    await form.getByRole('combobox', { name: 'Owner function' }).selectOption('Facilities')
    await form.getByRole('combobox', { name: 'Owner', exact: true }).selectOption({ label: suresh.name })
    await form.getByRole('combobox', { name: 'Verifier', exact: true }).selectOption({ label: 'Administrator' })
    await form.getByRole('button', { name: 'Raise issue' }).click()
    const row = page.getByRole('list', { name: 'Open issues' }).getByRole('listitem', { name: title })
    await expect(row).toContainText(`Not acknowledged by ${suresh.name}`)
    await expect(row).toContainText('Fix in')
  })

  const list = await request.get(`/api/table/tasker.issue?fields=["row_id","updated_at"]&filters=${encodeURIComponent(JSON.stringify([['issue_title', '=', title]]))}`, { headers: suresh.headers })
  const [issue] = (await list.json() as { data: { row_id: string; updated_at: string }[] }).data
  const save = async (values: Record<string, unknown>) => {
    const current = await (await request.get(`/api/table/tasker.issue/${issue.row_id}`, { headers: suresh.headers })).json() as { updated_at: string }
    const response = await request.post('/api/save_row', { headers: suresh.headers, data: { table: 'tasker.issue', row: { row_id: issue.row_id, updated_at: current.updated_at, ...values } } })
    expect(response.status(), await response.text()).toBe(201)
  }
  await save({ issue_state: 'Acknowledged' })
  await save({ issue_state: 'Submitted for verification', evidence_note: 'Compressor relay replaced; 3°C after an hour' })

  await session.step('the verifier sees the log and accepts', async ({ page }) => {
    await page.goto('/tasker/')
    await page.locator('.tasker-nav-issues').click()
    await page.getByRole('list', { name: 'Open issues' }).getByRole('link', { name: title }).click()
    const detail = page.getByRole('region', { name: 'Issue detail' })
    const log = detail.getByRole('list', { name: 'Escalation log' })
    await expect(log).toContainText(`Acknowledged by ${suresh.name}`)
    await expect(log).toContainText(`Submitted by ${suresh.name}`)
    await detail.getByRole('button', { name: 'Accept and close' }).click()
    await expect(detail.getByRole('group', { name: 'Verification clock' })).toContainText('Verified by Administrator')
  })
})
