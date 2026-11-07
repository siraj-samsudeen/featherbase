import { test, expect, ensureRuntimeApp, adminAuth } from './fixtures'

test.beforeAll(async ({ request }) => {
  await ensureRuntimeApp(request, 'equipment')
  const headers = await adminAuth(request)
  const person = await (await request.get('/api/table/Person/Administrator', { headers })).json() as { row_id: string; updated_at: string; roles: { role: string }[] }
  if (!person.roles.some(entry => entry.role === 'Assets Manager')) {
    const saved = await request.post('/api/save_row', { headers, data: { table: 'Person', row: {
      row_id: person.row_id, updated_at: person.updated_at, roles: [...person.roles, { role: 'Assets Manager' }],
    } } })
    expect(saved.status()).toBe(201)
  }
})

test('assets_fault_report: an asset opened by its label address takes a fault report that shows on the jobs board', async ({ session, request }) => {
  const headers = await ensureRuntimeApp(request, 'equipment')
  // E2E commits real rows, so this run's records have their own names.
  const run = Date.now()
  const save = async (table: string, row: Record<string, unknown>) => {
    const response = await request.post('/api/save_row', { headers, data: { table, row } })
    expect(response.status()).toBe(201)
    return await response.json() as { row_id: string }
  }
  const place = await save('equipment.place', { place_name: `Avadi Store ${run}` })
  const type = await save('equipment.asset_type', { type_name: `AC ${run}` })
  const asset = await save('equipment.asset', { asset_name: `Voltas split AC ${run}`, asset_type: type.row_id, place: place.row_id })
  const problem = `Not cooling ${run}`

  await session
    .visit(`/equipment/#asset=${asset.row_id}`)
    .assertHas('h1', { text: `Voltas split AC ${run}` })
    .fillIn('What’s wrong?', problem)
    .choose('Urgent')
    .clickButton('Send report')
    .within('section[aria-labelledby="open-jobs"]', open => open.assertText(problem))
    .clickLink('Repair jobs')
    .within('section[aria-label="Reported"]', column => column.assertText(problem))

  await session.step('the job is due within four hours, for the asset’s place', async () => {
    const filters = encodeURIComponent(JSON.stringify([['problem', '=', problem]]))
    const found = await (await request.get(`/api/table/equipment.job?filters=${filters}&fields=["place","reported_at","fix_by"]`, { headers })).json() as { data: { place: string; reported_at: string; fix_by: string }[] }
    expect(found.data).toHaveLength(1)
    expect(found.data[0].place).toBe(place.row_id)
    expect(Date.parse(found.data[0].fix_by) - Date.parse(found.data[0].reported_at)).toBe(4 * 3_600_000)
  })
})

test('assets_verification_count: a planned count starts, and its counter records an item blind', async ({ session, request }) => {
  const headers = await ensureRuntimeApp(request, 'equipment')
  const run = Date.now()
  const save = async (table: string, row: Record<string, unknown>) => {
    const response = await request.post('/api/save_row', { headers, data: { table, row } })
    expect(response.status()).toBe(201)
    return await response.json() as { row_id: string }
  }
  const site = await save('equipment.place', { place_name: `ATK ${run}`, place_level: 'Site', site_kind: 'Store' })
  const type = await save('equipment.asset_type', { type_name: `Scale ${run}` })
  const asset = await save('equipment.asset', { asset_name: `Weighing scale ${run}`, asset_type: type.row_id, place: site.row_id })
  // The reviewer must be another Assets Manager; the signed-in Administrator counts.
  await save('Person', { email: `reviewer.${run}@example.test`, full_name: `Reviewer ${run}`, enabled: true, roles: [{ role: 'Assets Manager' }] })

  await session
    .visit('/equipment/#counts')
    .fillIn('Count name', `ATK count ${run}`)
    .selectOption('Place to count', `ATK ${run}`)
    .selectOption('Reviewer', `Reviewer ${run}`)
    .check('Administrator')
    .clickButton('Plan count')
    .within(`tr:has-text("ATK count ${run}")`, row => row.assertText('Planned').clickButton('Start count'))
    .within(`tr:has-text("ATK count ${run}")`, row => row.assertText('Counting · 1 expected').clickLink('Record items'))
    .assertHas('h1', { text: `ATK count ${run}` })
    .selectOption('Area', `ATK ${run}`)
    .fillIn('Tag', asset.row_id)
    .selectOption('Outcome', 'Damaged')
    .clickButton('Record')
    .assertText(`You have recorded 1 item in ATK ${run}`)
    .refuteText('expected')

  await session.step('the record keeps who, where and what', async () => {
    const filters = encodeURIComponent(JSON.stringify([['asset', '=', asset.row_id]]))
    const found = await (await request.get(`/api/table/equipment.scan?filters=${filters}&fields=["outcome","area","created_by"]`, { headers })).json() as { data: { outcome: string; area: string; created_by: string }[] }
    expect(found.data).toEqual([{ outcome: 'Damaged', area: site.row_id, created_by: 'Administrator' }])
  })
})
