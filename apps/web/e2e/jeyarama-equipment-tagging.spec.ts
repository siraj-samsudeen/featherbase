import { test, expect, ensureRuntimeApp, adminAuth, tokenFor, bearer, type APIRequestContext } from './fixtures'

const PASSWORD = 'assets-tagging-e2e'

async function withRoles(request: APIRequestContext, roles: string[]) {
  const headers = await adminAuth(request)
  const person = await (await request.get('/api/table/Person/Administrator', { headers })).json() as { row_id: string; updated_at: string; roles: { role: string }[] }
  const missing = roles.filter(role => !person.roles.some(entry => entry.role === role))
  if (missing.length) {
    const saved = await request.post('/api/save_row', { headers, data: { table: 'Person', row: { row_id: person.row_id, updated_at: person.updated_at, roles: [...person.roles, ...missing.map(role => ({ role }))] } } })
    expect(saved.status()).toBe(201)
  }
}

/** A count team member who signs in through the API. */
async function member(request: APIRequestContext, name: string, versionHeader: string) {
  const headers = await adminAuth(request)
  const email = `${name.toLowerCase()}.${Date.now()}@example.com`
  const made = await request.post('/api/save_row', { headers, data: { table: 'Person', row: { email, full_name: name, enabled: true, roles: [{ role: 'Assets Member' }] } } })
  if (made.status() !== 201) throw new Error(`create person: ${made.status()} ${await made.text()}`)
  const { row_id } = await made.json() as { row_id: string }
  const set = await request.post('/api/set_password', { headers, data: { user: row_id, password: PASSWORD } })
  if (!set.ok()) throw new Error(`set password: ${set.status()}`)
  return { id: row_id, headers: { ...bearer(await tokenFor(request, email, PASSWORD)), 'X-Featherbase-App-Version': versionHeader } }
}

test.beforeAll(async ({ request }) => {
  await ensureRuntimeApp(request, 'equipment')
  await withRoles(request, ['Assets Manager', 'Assets Accountant'])
})

test('assets_atk_tagging: the team records a tagged line, the site manager signs the area, and the asset accountant matches it to SAP', async ({ session, request }) => {
  const headers = await ensureRuntimeApp(request, 'equipment')
  const run = Date.now()
  const first = (run % 9000) * 100 + 1
  const tag = `JRA-${String(first).padStart(6, '0')}`
  const save = async (row: Record<string, unknown>, table: string, as: Record<string, string> = headers) => {
    const response = await request.post('/api/save_row', { headers: as, data: { table, row } })
    expect(response.status(), await response.text()).toBe(201)
    return await response.json() as { row_id: string; updated_at: string }
  }
  const suresh = await member(request, 'Suresh', headers['X-Featherbase-App-Version'])
  const ravi = await member(request, 'Ravi', headers['X-Featherbase-App-Version'])
  await save({ person: 'Administrator', finance_role: 'Asset accountant' }, 'equipment.finance_person')
  const site = await save({ place_name: `ATK pilot ${run}`, place_level: 'Site', sap_plant: `P${run % 100000}`, site_manager: 'Administrator' }, 'equipment.place')
  const dairy = await save({ place_name: `Dairy ${run}`, place_level: 'Area', parent_place: site.row_id, area_code: `GF-${run}` }, 'equipment.place')
  const type = await save({ type_name: `Display chiller ${run}`, sticker: 'Freezer-grade' }, 'equipment.asset_type')
  await save({ roll_name: `Roll ${run}`, sticker: 'Freezer-grade', first_no: first, last_no: first + 9 }, 'equipment.tag_roll')
  const count = await save({ count_name: `Fresh count ${run}`, scope_place: site.row_id, count_kind: 'Fresh inventory', reviewer: 'Administrator' }, 'equipment.count')
  for (const person of [suresh.id, ravi.id]) await save({ count: count.row_id, person }, 'equipment.counter')
  const current = await (await request.get(`/api/table/equipment.count/${count.row_id}`, { headers })).json() as { updated_at: string }
  expect((await request.post('/api/app_actions/equipment/start_count', { headers, data: { idempotencyKey: crypto.randomUUID(), payload: { row_id: count.row_id, updated_at: current.updated_at } } })).status()).toBe(200)
  await save({ count: count.row_id, place: dairy.row_id, tag_status: 'Tagged', tag_no: tag, asset_type: type.row_id, asset_name: `3-door chiller ${run}`,
    serial_no: `SN-${run}`, condition: 'Working', ownership: 'Group owned', tagged_by: ravi.id }, 'equipment.count_line', suresh.headers)

  await session.visit(`/equipment/#count=${count.row_id}`)
  await session.step('the site manager signs the area after the label count adds up', async ({ page }) => {
    await page.getByRole('combobox', { name: 'Area' }).selectOption(dairy.row_id)
    const lines = page.getByRole('table', { name: 'Count lines' })
    await expect(lines).toContainText(tag)
    await expect(lines).toContainText('Tagged Ravi · recorded Suresh')
    const close = page.getByRole('region', { name: 'Close the area' })
    await close.getByRole('spinbutton', { name: 'Labels used' }).fill('1')
    await close.getByRole('button', { name: 'Sign as site manager' }).click()
    await expect(close.getByText('Signed for today.')).toBeVisible()
  })

  await session.step('the asset accountant pastes the book row and matches it by serial', async ({ page }) => {
    await page.goto('/equipment/#sap')
    await page.getByRole('combobox', { name: 'Plant' }).selectOption(`P${run % 100000}`)
    await page.getByRole('textbox', { name: 'SAP extract rows' }).fill(`S${run}\t0\tChiller 3-door\t3300\t12-03-2023\t142000\t1\tSN-${run}`)
    await page.getByRole('button', { name: 'Load rows' }).click()
    const record = page.getByRole('table', { name: 'SAP book' }).getByRole('row', { name: new RegExp(`S${run}-0`) })
    await expect(record).toContainText('Not found yet')
    await record.getByRole('button', { name: 'Match tags' }).click()
    const match = page.getByRole('form', { name: 'Match tags' })
    await match.getByRole('textbox', { name: 'Tags' }).fill(tag)
    await match.getByRole('button', { name: 'Match', exact: true }).click()
    await expect(record).toContainText('Found')
    await expect(page.getByRole('group', { name: 'Reconciliation' })).toContainText('Book match rate100%')
  })
})
