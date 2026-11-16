// #1223 design B on the real platform: Your store / Your floor, and moving a staff member.
// Made-up stores and people only. Approval is approve-first here, as on a fresh instance.
import { randomUUID } from 'node:crypto'
import { describe, expect, vi } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { createCoreTables, installApp, pinned, saveRow } from './helpers'

vi.setConfig({ testTimeout: 60_000 })
process.env.MOTHERDUCK_TOKEN = 'made-up-token'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
const read = async (client: TestClient, name: string, payload: object = {}) =>
  (await client.post<any>(`/api/app_reads/dash/${name}`, { payload })).result
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
// #1243: ends_on is a row's last day; a row has ended once its ends_on is before today.
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
const act = (client: TestClient, name: string, payload: object) =>
  client.post<any>(`/api/app_actions/dash/${name}`, { idempotencyKey: randomUUID(), payload }).then(r => r.result)

async function world(admin: TestClient, createUser: CreateUserFn) {
  await installApp(admin)
  await createCoreTables(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Master Data Editor' } })
  const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
  const person = (name: string) => createUser({ email: `${name}-${randomUUID()}@example.test`, roles: ['Dash Reader'] })
  const [store, floor, otherFloor, leader] = await Promise.all(['store', 'floor', 'other-floor', 'leader'].map(person))
  await sql`update person set password_hash = 'made-up' where row_id in ${sql([store, floor, otherFloor, leader].map(p => p.user!))}`
  for (const [code, name] of [['LKS', 'Lakeside'], ['HIL', 'Hillview']]) await save('Site', { code, name, is_store: true })
  await save('Store Floor', { row_id: 'LKS-F1', name: 'First floor', site: 'LKS' })
  await save('Store Floor', { row_id: 'LKS-F2', name: 'Second floor', site: 'LKS' })
  await save('Section', { row_id: 'LKS-S1', name: 'Sarees', site: 'LKS', floor: 'LKS-F1', status: 'Active' })
  await save('Section', { row_id: 'LKS-S2', name: 'Silk', site: 'LKS', floor: 'LKS-F1', status: 'Active' })
  await save('Section', { row_id: 'LKS-S3', name: 'Kids Wear', site: 'LKS', floor: 'LKS-F2', status: 'Active' })
  await save('Section', { row_id: 'HIL-S1', name: 'Hillview Silk', site: 'HIL', status: 'Active' })
  const employee = (code: string, name: string, who?: TestClient) => save('Employee', { employee_code: code, name, person: who?.user, status: 'Current' })
  await employee('2001', 'Selvi Store', store)
  await employee('2002', 'Farah Floor', floor)
  await employee('2003', 'Ojas Other-Floor', otherFloor)
  await employee('2004', 'Asha Leader', leader)
  await employee('2005', 'Hari Hillview')
  const job = (assignment_id: string, employee: string, job: string, site: string, more: object = {}) =>
    save('Job Assignment', { assignment_id, employee, job, site, starts_on: '2026-10-01', ...more })
  await job('JA-SM', '2001', 'Store Manager', 'LKS')
  await job('JA-FM', '2002', 'Floor Manager', 'LKS', { floor: 'LKS-F1', reports_to: '2001' })
  await job('JA-FM2', '2003', 'Floor Manager', 'LKS', { floor: 'LKS-F2', reports_to: '2001' })
  await job('JA-TL', '2004', 'Team Leader', 'LKS', { section: 'LKS-S1', reports_to: '2001' })
  await job('JA-HIL', '2005', 'Staff', 'HIL', { section: 'HIL-S1' })
  return { store, floor, otherFloor, leader }
}

describe('#1223 Your store and Your floor', () => {
  test('#1245: each area names the open Store Manager and Cluster Managers of its store, by job', async ({ admin, createUser }) => {
    const { store, floor } = await world(admin, createUser)
    const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
    for (const [code, name, status] of [['3001', 'Kiran Cluster', 'Current'], ['3002', 'Lata Cluster', 'Current'], ['3003', 'Moni Gone', 'Current'], ['3004', 'Nila Ending', 'Current'], ['3005', 'Oviya Left', 'Left']])
      await save('Employee', { employee_code: code, name, status })
    const job = (assignment_id: string, employee: string, job: string, more: object = {}) =>
      save('Job Assignment', { assignment_id, employee, job, site: 'LKS', starts_on: '2026-10-01', ...more })
    await job('JA-CM1', '3002', 'Cluster Manager')
    await job('JA-CM2', '3001', 'Cluster Manager')
    await job('JA-SM-OLD', '3003', 'Store Manager', { ends_on: yesterday })
    await job('JA-SM-LAST', '3004', 'Store Manager', { ends_on: today })
    await job('JA-SM-LEFT', '3005', 'Store Manager')
    const managers = (answer: any) => answer.places.map((p: any) => [p.kind, p.managers])
    const lakeside = { store: [{ code: '3004', name: 'Nila Ending' }, { code: '2001', name: 'Selvi Store' }], cluster: [{ code: '3001', name: 'Kiran Cluster' }, { code: '3002', name: 'Lata Cluster' }] }
    expect(managers(await read(store, 'my_store'))).toEqual([['store', lakeside]])
    expect(managers(await read(floor, 'my_store'))).toEqual([['floor', lakeside]])
  })

  test('#1245: a store with no open Store Manager names none', async ({ admin, createUser }) => {
    const { otherFloor } = await world(admin, createUser)
    await saveRow(admin, 'Store Floor', { row_id: 'HIL-F1', name: 'Ground floor', site: 'HIL' })
    await saveRow(admin, 'Section', { row_id: 'HIL-S2', name: 'Hillview Sarees', site: 'HIL', floor: 'HIL-F1', status: 'Active' })
    await saveRow(admin, 'Job Assignment', { assignment_id: 'JA-HIL-FM', employee: '2003', job: 'Floor Manager', site: 'HIL', floor: 'HIL-F1', starts_on: '2026-10-01' })
    const hillview = (await read(otherFloor, 'my_store')).places.find((p: any) => p.store_id === 'HIL')
    expect(hillview.managers).toEqual({ store: [], cluster: [] })
  })

  test('each manager sees their own area only, named for it', async ({ admin, createUser }) => {
    const { store, floor, leader } = await world(admin, createUser)
    expect(await read(store, 'manages_area')).toBe('Your store')
    expect(await read(floor, 'manages_area')).toBe('Your floor')
    expect(await read(leader, 'manages_area')).toBeNull()
    const whole = await read(store, 'my_store')
    expect(whole.places).toHaveLength(1)
    expect(whole.places[0].floors.flatMap((f: any) => f.sections.map((s: any) => s.id)).sort()).toEqual(['LKS-S1', 'LKS-S2', 'LKS-S3'])
    expect(whole.places[0].staff.map((s: any) => s.job_id).sort()).toEqual(['JA-FM', 'JA-FM2', 'JA-TL'])
    const first = await read(floor, 'my_store')
    expect(first.places[0].floors.flatMap((f: any) => f.sections.map((s: any) => s.id)).sort()).toEqual(['LKS-S1', 'LKS-S2'])
    expect(first.places[0].staff.map((s: any) => s.job_id)).toEqual(['JA-TL'])
    // A Team Leader's area is their section: shown on Your sections, not as Your store.
    expect((await read(leader, 'my_store')).places.map((p: any) => [p.kind, p.page, p.staff.map((s: any) => s.job_id)])).toEqual([['section', 'Your sections', []]])
  })

  test('a move outside their area, of another manager, or of themselves is refused', async ({ admin, createUser }) => {
    const { store, floor } = await world(admin, createUser)
    const refused = /own staff, within your own area|Only Staff and Team Leaders|can't move yourself/
    await expect(act(floor, 'move_staff', { job: 'JA-TL', to_section: 'LKS-S3' })).rejects.toThrow(refused)
    await expect(act(store, 'move_staff', { job: 'JA-HIL', to_section: 'LKS-S1' })).rejects.toThrow(refused)
    await expect(act(store, 'move_staff', { job: 'JA-FM2', to_section: 'LKS-S1' })).rejects.toThrow(refused)
    await expect(act(floor, 'move_staff', { job: 'JA-FM', to_section: 'LKS-S2' })).rejects.toThrow(refused)
    expect(await sql`select 1 from featherbase.change_proposal`).toHaveLength(0)
  })

  test('approve-first: the moved person\'s manager approves a floor manager\'s move, and it applies', async ({ admin, createUser }) => {
    const { store, floor } = await world(admin, createUser)
    const asked = await act(floor, 'move_staff', { job: 'JA-TL', to_section: 'LKS-S2' })
    expect(asked.state).toBe('Pending')
    const waiting = await read(store, 'approvals')
    expect(waiting.proposals.map((p: any) => [p.id, p.who, p.from.section, p.to.section])).toEqual([[asked.id, 'Farah Floor', 'Sarees', 'Silk']])
    expect(await act(store, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Applied' })
    const rows = await sql`select section, ends_on from featherbase.job_assignment where employee = '2004' order by starts_on`
    expect(rows.map(r => r.section)).toEqual(['LKS-S1', 'LKS-S2'])
    expect(rows[1].ends_on).toBeNull()
  })

  test('a manager whose job ended yesterday has no area today', async ({ admin, createUser }) => {
    const { floor } = await world(admin, createUser)
    await sql`update featherbase.job_assignment set ends_on = ${yesterday}::date where row_id = 'JA-FM'`
    expect(await read(floor, 'manages_area')).toBeNull()
    await expect(act(floor, 'move_staff', { job: 'JA-TL', to_section: 'LKS-S2' })).rejects.toThrow(/own staff, within your own area/)
  })

  test('a category head sees a buyer named only at division level as covering their category', async ({ admin, createUser }) => {
    const { leader } = await world(admin, createUser)
    const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
    await save('Division', { division: 'Women' })
    await save('Subdivision', { subdivision: 'Ethnic', division: 'Women' })
    await save('Category', { category: 'Sarees', subdivision: 'Ethnic' })
    for (const [row_id, subcategory] of [['010101001', 'Silk sarees'], ['010101002', 'Cotton sarees']])
      await save('Subcategory', { row_id, subcategory, category: 'Sarees', subdivision: 'Ethnic', division: 'Women', subcategory_type: 'Merchandise' })
    await save('Employee', { employee_code: '2010', name: 'Uma Buyer', status: 'Current' })
    await save('Merchandise Assignment', { assignment_id: 'MA-HEAD', employee: '2004', responsibility: 'Category head', category: 'Sarees', starts_on: '2026-10-01' })
    await save('Merchandise Assignment', { assignment_id: 'MA-BUY', employee: '2010', responsibility: 'Buyer', division: 'Women', starts_on: '2026-10-01' })
    const answer = await read(leader, 'my_store')
    expect(answer.categories).toEqual([expect.objectContaining({ category: 'Sarees', no_buyer: [], buyers: [expect.objectContaining({ name: 'Uma Buyer', code: '2010', buys: 'All of Women' })] })])
  })

  test("a job's old floor doesn't let a floor manager move someone whose section is now on another floor", async ({ admin, createUser }) => {
    const { floor } = await world(admin, createUser)
    await sql`update featherbase.job_assignment set floor = 'LKS-F1', section = 'LKS-S3' where row_id = 'JA-TL'`
    await expect(act(floor, 'move_staff', { job: 'JA-TL', to_section: 'LKS-S2' })).rejects.toThrow(/own staff, within your own area/)
    expect((await read(floor, 'my_store')).places[0].staff.map((s: any) => s.job_id)).not.toContain('JA-TL')
  })

  test("a store manager moving their own direct report is told the master data team decides, not themselves", async ({ admin, createUser }) => {
    const { store } = await world(admin, createUser)
    const editor = await createUser({ email: `editor-${randomUUID()}@example.test`, roles: ['Dash Reader', 'Master Data Editor'] })
    await sql`update person set password_hash = 'made-up' where row_id = ${editor.user!}`
    const asked = await act(store, 'move_staff', { job: 'JA-TL', to_section: 'LKS-S2' })
    expect(asked).toMatchObject({ state: 'Pending', reviewer: 'the master data team' })
  })

  test('someone who has left is neither listed nor moved', async ({ admin, createUser }) => {
    const { store } = await world(admin, createUser)
    await sql`update featherbase.employee set status = 'Left' where row_id = '2004'`
    expect((await read(store, 'my_store')).places[0].staff.map((s: any) => s.job_id)).not.toContain('JA-TL')
    await expect(act(store, 'move_staff', { job: 'JA-TL', to_section: 'LKS-S2' })).rejects.toThrow(/no longer on the staff list/)
  })

  test('approve-first: a move goes stale when the moved job has ended by the day it is approved', async ({ admin, createUser }) => {
    const { store, floor } = await world(admin, createUser)
    const asked = await act(floor, 'move_staff', { job: 'JA-TL', to_section: 'LKS-S2' })
    await sql`update featherbase.job_assignment set ends_on = ${yesterday}::date where row_id = 'JA-TL'`
    expect(await act(store, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    expect((await sql`select section from featherbase.job_assignment where employee = '2004'`).map(r => r.section)).toEqual(['LKS-S1'])
  })

  test('a head of one subcategory sees that subcategory only, not its whole category', async ({ admin, createUser }) => {
    const { leader } = await world(admin, createUser)
    const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
    await save('Division', { division: 'Women' })
    await save('Subdivision', { subdivision: 'Ethnic', division: 'Women' })
    await save('Category', { category: 'Sarees', subdivision: 'Ethnic' })
    for (const [row_id, subcategory] of [['010101001', 'Silk sarees'], ['010101002', 'Cotton sarees']])
      await save('Subcategory', { row_id, subcategory, category: 'Sarees', subdivision: 'Ethnic', division: 'Women', subcategory_type: 'Merchandise' })
    await save('Employee', { employee_code: '2012', name: 'Cotton Buyer', status: 'Current' })
    await save('Merchandise Assignment', { assignment_id: 'MA-HEAD', employee: '2004', responsibility: 'Category head', subcategory: '010101001', starts_on: '2026-10-01' })
    await save('Merchandise Assignment', { assignment_id: 'MA-COTTON', employee: '2012', responsibility: 'Buyer', subcategory: '010101002', starts_on: '2026-10-01' })
    expect((await read(leader, 'my_store')).categories).toEqual([expect.objectContaining({ category: 'Sarees', buyers: [], no_buyer: [{ code: '010101001', name: 'Silk sarees' }] })])
  })

  test('for a head with no region, a buyer of one region leaves the other regions a gap, and says which region', async ({ admin, createUser }) => {
    const { leader } = await world(admin, createUser)
    const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
    await save('Operating Region', { region: 'East' })
    await save('Division', { division: 'Women' })
    await save('Subdivision', { subdivision: 'Ethnic', division: 'Women' })
    await save('Category', { category: 'Sarees', subdivision: 'Ethnic' })
    await save('Subcategory', { row_id: '010101001', subcategory: 'Silk sarees', category: 'Sarees', subdivision: 'Ethnic', division: 'Women', subcategory_type: 'Merchandise' })
    await save('Employee', { employee_code: '2013', name: 'East Buyer', status: 'Current' })
    await save('Merchandise Assignment', { assignment_id: 'MA-HEAD', employee: '2004', responsibility: 'Category head', category: 'Sarees', starts_on: '2026-10-01' })
    await save('Merchandise Assignment', { assignment_id: 'MA-EAST', employee: '2013', responsibility: 'Buyer', category: 'Sarees', operating_region: 'East', starts_on: '2026-10-01' })
    expect((await read(leader, 'my_store')).categories).toEqual([expect.objectContaining({ no_buyer: [{ code: '010101001', name: 'Silk sarees' }],
      buyers: [expect.objectContaining({ name: 'East Buyer', buys: 'All of Sarees, East only' })] })])
  })

  test('a buyer who has left covers nothing: their subcategories show with no buyer', async ({ admin, createUser }) => {
    const { leader } = await world(admin, createUser)
    const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
    await save('Division', { division: 'Women' })
    await save('Subdivision', { subdivision: 'Ethnic', division: 'Women' })
    await save('Category', { category: 'Sarees', subdivision: 'Ethnic' })
    await save('Subcategory', { row_id: '010101001', subcategory: 'Silk sarees', category: 'Sarees', subdivision: 'Ethnic', division: 'Women', subcategory_type: 'Merchandise' })
    await save('Employee', { employee_code: '2011', name: 'Gone Buyer', status: 'Left' })
    await save('Merchandise Assignment', { assignment_id: 'MA-HEAD', employee: '2004', responsibility: 'Category head', category: 'Sarees', starts_on: '2026-10-01' })
    await save('Merchandise Assignment', { assignment_id: 'MA-GONE', employee: '2011', responsibility: 'Buyer', category: 'Sarees', starts_on: '2026-10-01' })
    expect((await read(leader, 'my_store')).categories).toEqual([expect.objectContaining({ buyers: [], no_buyer: [{ code: '010101001', name: 'Silk sarees' }] })])
  })

  test('approve-first: a move goes stale when its maker no longer manages that floor', async ({ admin, createUser }) => {
    const { store, floor } = await world(admin, createUser)
    const asked = await act(floor, 'move_staff', { job: 'JA-TL', to_section: 'LKS-S2' })
    await sql`update featherbase.job_assignment set ends_on = '2026-10-02' where row_id = 'JA-FM'`
    expect(await act(store, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
  })

  describe('What they cover', () => {
    async function withDepartment(admin: TestClient, createUser: CreateUserFn) {
      const w = await world(admin, createUser)
      const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
      await save('Section', { row_id: 'LKS-S4', name: 'Girls Tops', site: 'LKS', floor: 'LKS-F2', status: 'Active' })
      await save('Division', { division: 'Kids' })
      await save('Subdivision', { subdivision: 'Girls', division: 'Kids' })
      await save('Category', { category: 'Girls wear', subdivision: 'Girls' })
      await save('Subcategory', { row_id: '020101001', subcategory: 'Girls frocks', category: 'Girls wear', subdivision: 'Girls', division: 'Kids', subcategory_type: 'Merchandise' })
      await save('Section Subcategory', { section_subcategory_id: 'P-1', store: 'LKS', subcategory: '020101001', section: 'LKS-S3', starts_on: '2026-10-01' })
      await save('Employee', { employee_code: '2020', name: 'Dina Department' })
      await sql`update featherbase.employee set status = 'Current' where row_id = '2020'`
      await save('Job Assignment', { assignment_id: 'JA-DM', employee: '2020', job: 'Department Manager', site: 'LKS', reports_to: '2001', starts_on: '2026-10-01' })
      await save('Department', { department_id: 'LKS-KIDS', store: 'LKS', name: 'Kids Wear & Girls Tops', manager: '2020', starts_on: '2026-10-01' })
      for (const section of ['LKS-S3', 'LKS-S4'])
        await save('Department Section', { department_section_id: `LKS-KIDS-${section}`, store: 'LKS', department: 'LKS-KIDS', section, starts_on: '2026-10-01' })
      const editor = await createUser({ email: `editor-${randomUUID()}@example.test`, roles: ['Dash Reader', 'Master Data Editor'] })
      return { ...w, editor }
    }

    test('a department manager is rolled up to their sections, and an empty section is named as a gap', async ({ admin, createUser }) => {
      const { store } = await withDepartment(admin, createUser)
      const answer = await read(store, 'coverage', { employee: '2020' })
      expect(answer.jobs[0].departments[0]).toMatchObject({ name: 'Kids Wear & Girls Tops', sections: [
        expect.objectContaining({ name: 'Girls Tops', subcategories: 0 }), expect.objectContaining({ name: 'Kids Wear', subcategories: 1 })] })
      expect(answer.gaps).toEqual(['Kids Wear & Girls Tops › Girls Tops · no subcategories'])
      const department = await read(store, 'coverage', { department: 'LKS-KIDS' })
      expect(department.department).toMatchObject({ manager: 'Dina Department', gaps: ['Girls Tops · no subcategories'] })
    })

    test('a floor manager sees their own floor\'s staff only; a Team Leader only themselves', async ({ admin, createUser }) => {
      const { floor, leader } = await withDepartment(admin, createUser)
      expect(await read(floor, 'coverage', { employee: '2004' })).toMatchObject({ state: 'ok' })
      expect(await read(floor, 'coverage', { employee: '2003' })).toEqual({ state: 'not_allowed' })
      expect(await read(leader, 'coverage', { employee: '2001' })).toEqual({ state: 'not_allowed' })
      expect(await read(leader, 'coverage', {})).toMatchObject({ state: 'ok', employee: { code: '2004' } })
      expect(await read(leader, 'coverage', { department: 'LKS-KIDS' })).toEqual({ state: 'not_allowed' })
    })

    test('a manager sees only the jobs inside their area, not another store\'s department nor merchandise', async ({ admin, createUser }) => {
      const { floor } = await withDepartment(admin, createUser)
      // Asha holds a Team Leader job on Farah's floor and is also Hillview's department manager and a buyer.
      await saveRow(admin, 'Section', { row_id: 'HIL-S2', name: 'Hillview Tops', site: 'HIL', status: 'Active' })
      await saveRow(admin, 'Job Assignment', { assignment_id: 'JA-TL-HIL', employee: '2004', job: 'Department Manager', site: 'HIL', starts_on: '2026-10-01' })
      await saveRow(admin, 'Department', { department_id: 'HIL-D', store: 'HIL', name: 'Hillview Department', manager: '2004', starts_on: '2026-10-01' })
      await saveRow(admin, 'Department Section', { department_section_id: 'HIL-D-S2', store: 'HIL', department: 'HIL-D', section: 'HIL-S2', starts_on: '2026-10-01' })
      await saveRow(admin, 'Merchandise Assignment', { assignment_id: 'MA-2', employee: '2004', responsibility: 'Buyer', category: 'Girls wear', starts_on: '2026-10-01' })
      const answer = await read(floor, 'coverage', { employee: '2004' })
      expect(answer.area_only).toBe(true)
      expect(answer.jobs.map((j: any) => [j.job, j.store])).toEqual([['Team Leader', 'Lakeside']])
      expect(answer.merchandise).toEqual([])
      expect(JSON.stringify(answer)).not.toContain('Hillview')
      expect(await read(floor, 'coverage', { department: 'HIL-D' })).toEqual({ state: 'not_allowed' })
    })

    test("a floor manager sees only their floor's sections of a department that spans two floors", async ({ admin, createUser }) => {
      const { floor } = await withDepartment(admin, createUser)
      // Dina's department job is on Farah's first floor; her department also holds the second floor's Kids Wear and Girls Tops.
      await sql`update featherbase.job_assignment set floor = 'LKS-F1' where row_id = 'JA-DM'`
      await saveRow(admin, 'Department Section', { department_section_id: 'LKS-KIDS-LKS-S1', store: 'LKS', department: 'LKS-KIDS', section: 'LKS-S1', starts_on: '2026-10-01' })
      const answer = await read(floor, 'coverage', { employee: '2020' })
      expect(answer.area_only).toBe(true)
      expect(answer.jobs[0].departments[0].sections.map((s: any) => s.name)).toEqual(['Sarees'])
      // Only its own floor's gap: nothing about the second floor's sections.
      expect(answer.gaps).toEqual(['Kids Wear & Girls Tops › Sarees · no subcategories'])
    })

    test("a link to another store's section is never followed: a gap says so, nothing of that store shows", async ({ admin, createUser }) => {
      const { store } = await withDepartment(admin, createUser)
      await saveRow(admin, 'Section', { row_id: 'HIL-S9', name: 'Hillview Secret', site: 'HIL', status: 'Active' })
      await sql`update featherbase.job_assignment set section = 'HIL-S9' where row_id = 'JA-TL'`
      await saveRow(admin, 'Department Section', { department_section_id: 'LKS-KIDS-HIL', store: 'LKS', department: 'LKS-KIDS', section: 'HIL-S9', starts_on: '2026-10-01' })
      const person = await read(store, 'coverage', { employee: '2004' })
      expect(JSON.stringify(person)).not.toContain('Hillview Secret')
      expect(person.gaps).toContain('1 linked section belongs to another store')
      const department = await read(store, 'coverage', { department: 'LKS-KIDS' })
      expect(JSON.stringify(department)).not.toContain('Hillview Secret')
      expect(department.department.gaps).toContain('1 linked section belongs to another store')
    })

    test("a floor manager's job with a stale section on my floor shows nothing of their own floor to me", async ({ admin, createUser }) => {
      const { floor } = await withDepartment(admin, createUser)
      // Ojas manages the second floor, but his job row still names a first-floor section.
      await sql`update featherbase.job_assignment set section = 'LKS-S1' where row_id = 'JA-FM2'`
      const answer = await read(floor, 'coverage', { employee: '2003' })
      expect(answer.area_only).toBe(true)
      expect(answer.jobs[0].sections.map((s: any) => s.name)).toEqual([])
      expect(JSON.stringify(answer)).not.toMatch(/Kids Wear|Girls Tops/)
    })

    test('a Cluster Manager at a site with no cluster, named by none, is a gap, not whole coverage', async ({ admin, createUser }) => {
      const { editor } = await withDepartment(admin, createUser)
      await saveRow(admin, 'Job Assignment', { assignment_id: 'JA-CM', employee: '2020', job: 'Cluster Manager', site: 'LKS', starts_on: '2026-10-01' })
      const job = (await read(editor, 'coverage', { employee: '2020' })).jobs.find((j: any) => j.job === 'Cluster Manager')
      expect(job).toMatchObject({ whole_store: false, gaps: ['This site belongs to no cluster, and no cluster names them as its head'] })
    })

    test("a department's named manager sees it only while their Department Manager job holds", async ({ admin, createUser }) => {
      await withDepartment(admin, createUser)
      const dina = await createUser({ email: `dina-${randomUUID()}@example.test`, roles: ['Dash Reader'] })
      await sql`update featherbase.employee set person = ${dina.user!} where row_id = '2020'`
      expect(await read(dina, 'coverage', { department: 'LKS-KIDS' })).toMatchObject({ state: 'ok' })
      await sql`update featherbase.job_assignment set ends_on = '2026-10-02' where row_id = 'JA-DM'`
      expect(await read(dina, 'coverage', { department: 'LKS-KIDS' })).toEqual({ state: 'not_allowed' })
    })

    async function withTeams(admin: TestClient, createUser: CreateUserFn) {
      const w = await withDepartment(admin, createUser)
      const dina = await createUser({ email: `dina-${randomUUID()}@example.test`, roles: ['Dash Reader'] })
      await sql`update person set password_hash = 'made-up' where row_id = ${dina.user!}`
      await sql`update featherbase.employee set person = ${dina.user!} where row_id = '2020'`
      // The master data team must be able to sign in to be anyone's reviewer.
      await sql`update person set password_hash = 'made-up' where row_id = ${w.editor.user!}`
      await saveRow(admin, 'Employee', { employee_code: '2030', name: 'Kala Kids-Staff', status: 'Current' })
      await saveRow(admin, 'Employee', { employee_code: '2031', name: 'Sundar Sarees-Staff', status: 'Current' })
      await saveRow(admin, 'Job Assignment', { assignment_id: 'JA-KS', employee: '2030', job: 'Staff', site: 'LKS', section: 'LKS-S3', reports_to: '2020', starts_on: '2026-10-01' })
      await saveRow(admin, 'Job Assignment', { assignment_id: 'JA-SS', employee: '2031', job: 'Staff', site: 'LKS', section: 'LKS-S1', reports_to: '2004', starts_on: '2026-10-01' })
      return { ...w, dina }
    }

    test("a Department Manager sees their department's team and moves them between its sections only", async ({ admin, createUser }) => {
      const { dina, store } = await withTeams(admin, createUser)
      const answer = await read(dina, 'my_store', { kinds: ['department'] })
      expect(answer.places.map((p: any) => [p.kind, p.department?.name, p.staff.map((s: any) => s.job_id)])).toEqual([['department', 'Kids Wear & Girls Tops', ['JA-KS']]])
      await expect(act(dina, 'move_staff', { job: 'JA-KS', to_section: 'LKS-S1' })).rejects.toThrow(/own staff, within your own area/)
      await expect(act(dina, 'move_staff', { job: 'JA-SS', to_section: 'LKS-S3' })).rejects.toThrow(/own staff, within your own area/)
      const asked = await act(dina, 'move_staff', { job: 'JA-KS', to_section: 'LKS-S4' })
      expect(asked.state).toBe('Pending')
      // Kala reports to Dina, who made the move, so the master data team decides it; the store manager isn't asked.
      expect((await read(store, 'approvals')).proposals.map((p: any) => p.id)).not.toContain(asked.id)
    })

    test("a Department Manager's move goes stale once their department job ends", async ({ admin, createUser }) => {
      const { dina, editor } = await withTeams(admin, createUser)
      const asked = await act(dina, 'move_staff', { job: 'JA-KS', to_section: 'LKS-S4' })
      await sql`update featherbase.job_assignment set ends_on = '2026-10-02' where row_id = 'JA-DM'`
      expect(await act(editor, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    })

    test('a Team Leader sees their own team and moves Staff only, within their own sections', async ({ admin, createUser }) => {
      const { leader } = await withTeams(admin, createUser)
      const answer = await read(leader, 'my_store', { kinds: ['section'] })
      expect(answer.places[0].staff.map((s: any) => [s.job_id, s.movable])).toEqual([['JA-SS', true]])
      // Only one section of their own: nowhere to move to inside it.
      await expect(act(leader, 'move_staff', { job: 'JA-SS', to_section: 'LKS-S2' })).rejects.toThrow(/own staff, within your own area/)
      expect(await read(leader, 'coverage', { employee: '2031' })).toMatchObject({ state: 'ok', area_only: true })
      expect(await read(leader, 'coverage', { employee: '2030' })).toEqual({ state: 'not_allowed' })
    })

    test('a Department Manager sees what their own staff cover, and not other departments\' staff', async ({ admin, createUser }) => {
      const { dina } = await withTeams(admin, createUser)
      expect(await read(dina, 'coverage', { employee: '2030' })).toMatchObject({ state: 'ok', area_only: true })
      expect(await read(dina, 'coverage', { employee: '2031' })).toEqual({ state: 'not_allowed' })
    })

    test('a Store Manager takes a subcategory out of a section in their store; the master data team approves it', async ({ admin, createUser }) => {
      const { store, editor } = await withTeams(admin, createUser)
      const before = await read(store, 'section_subcategories', { section: 'LKS-S3' })
      expect(before.placed.map((p: any) => [p.placement, p.name])).toEqual([['P-1', 'Girls frocks']])
      const asked = await act(store, 'manage_remove', { placement: 'P-1' })
      expect(asked.state).toBe('Pending')
      expect((await read(editor, 'approvals')).proposals.map((p: any) => p.id)).toContain(asked.id)
      expect(await act(editor, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Applied' })
      expect((await read(store, 'section_subcategories', { section: 'LKS-S3' })).placed).toEqual([])
    })

    test('a Store Manager adds a subcategory to a section, moving it from where it was in the store', async ({ admin, createUser }) => {
      const { store, editor } = await withTeams(admin, createUser)
      const asked = await act(store, 'manage_add', { section: 'LKS-S4', subcategory: '020101001' })
      expect(asked.state).toBe('Pending')
      expect(await act(editor, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Applied' })
      expect((await read(store, 'section_subcategories', { section: 'LKS-S4' })).placed.map((p: any) => p.code)).toEqual(['020101001'])
      expect((await read(store, 'section_subcategories', { section: 'LKS-S3' })).placed).toEqual([])
    })

    test("a Floor Manager can't change another floor's section; a Team Leader can't use these at all", async ({ admin, createUser }) => {
      const { floor, leader } = await withTeams(admin, createUser)
      expect(await read(floor, 'section_subcategories', { section: 'LKS-S3' })).toEqual({ state: 'not_allowed' })
      await expect(act(floor, 'manage_remove', { placement: 'P-1' })).rejects.toThrow(/own store, floor or department/)
      await expect(act(floor, 'manage_add', { section: 'LKS-S3', subcategory: '020101001' })).rejects.toThrow(/own store, floor or department/)
      await expect(act(leader, 'manage_add', { section: 'LKS-S1', subcategory: '020101001' })).rejects.toThrow(/own store, floor or department/)
    })

    test("a Floor Manager can't take a subcategory from another floor's section by adding it to their own", async ({ admin, createUser }) => {
      const { floor } = await withTeams(admin, createUser)
      // Girls frocks sits in Kids Wear on the second floor; Farah manages the first floor.
      await expect(act(floor, 'manage_add', { section: 'LKS-S2', subcategory: '020101001' })).rejects.toThrow(/outside your area/)
      expect((await sql`select count(*)::int as n from featherbase.change_proposal`)[0].n).toBe(0)
    })

    test("a manager's addition goes stale if the section it comes from leaves their area", async ({ admin, createUser }) => {
      const { dina, store } = await withTeams(admin, createUser)
      // Girls frocks moves from Kids Wear to Girls Tops, both in Dina's department; then Kids Wear leaves it.
      // Dina reports to Selvi, the Store Manager, who reviews her changes.
      const asked = await act(dina, 'manage_add', { section: 'LKS-S4', subcategory: '020101001' })
      await sql`update featherbase.department_section set ends_on = '2026-10-02' where row_id = 'LKS-KIDS-LKS-S3'`
      expect(await act(store, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    })

    test('a placement that ended yesterday is out of the section on every manager path, as on the counts', async ({ admin, createUser }) => {
      const { store } = await withTeams(admin, createUser)
      await sql`update featherbase.section_subcategory set ends_on = ${yesterday}::date where row_id = 'P-1'`
      expect((await read(store, 'section_subcategories', { section: 'LKS-S3' })).placed).toEqual([])
      await expect(act(store, 'manage_remove', { placement: 'P-1' })).rejects.toThrow(/not in this section/)
    })

    test("a manager's addition from a section goes stale if that placement has ended by approval", async ({ admin, createUser }) => {
      const { store, editor } = await withTeams(admin, createUser)
      const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
      await sql`update featherbase.section_subcategory set ends_on = ${tomorrow}::date where row_id = 'P-1'`
      const asked = await act(store, 'manage_add', { section: 'LKS-S4', subcategory: '020101001' })
      // Days pass: by approval the source placement has ended.
      await sql`update featherbase.section_subcategory set ends_on = ${yesterday}::date where row_id = 'P-1'`
      expect(await act(editor, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
      expect((await read(store, 'section_subcategories', { section: 'LKS-S4' })).placed).toEqual([])
    })

    test('a manager adds a subcategory whose placement ended yesterday, and it is approved today', async ({ admin, createUser }) => {
      const { store, editor } = await withTeams(admin, createUser)
      await sql`update featherbase.section_subcategory set ends_on = ${yesterday}::date where row_id = 'P-1'`
      const asked = await act(store, 'manage_add', { section: 'LKS-S4', subcategory: '020101001' })
      expect(asked.state).toBe('Pending')
      expect(await act(editor, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Applied' })
    })

    test("a manager's change goes stale once their job ends", async ({ admin, createUser }) => {
      const { store, editor } = await withTeams(admin, createUser)
      const asked = await act(store, 'manage_remove', { placement: 'P-1' })
      await sql`update featherbase.job_assignment set ends_on = '2026-10-02' where row_id = 'JA-SM'`
      expect(await act(editor, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    })

    test("a department's manager no longer sees it once the department has ended, though their job holds", async ({ admin, createUser }) => {
      const { dina } = await withTeams(admin, createUser)
      expect(await read(dina, 'coverage', { department: 'LKS-KIDS' })).toMatchObject({ state: 'ok' })
      await sql`update featherbase.department set ends_on = '2026-10-02' where row_id = 'LKS-KIDS'`
      expect(await read(dina, 'coverage', { department: 'LKS-KIDS' })).toEqual({ state: 'not_allowed' })
    })

    test('the person search finds only people the viewer may see', async ({ admin, createUser }) => {
      const { floor, editor } = await withTeams(admin, createUser)
      // Farah (first floor) finds Asha (Sarees, first floor) but not Kala (Kids Wear, second floor).
      expect((await read(floor, 'coverage_people', { q: 'a' })).map((p: any) => p.code)).toEqual([])
      expect((await read(floor, 'coverage_people', { q: 'asha' })).map((p: any) => [p.code, p.line])).toEqual([['2004', '2004 · Team Leader · Lakeside']])
      expect(await read(floor, 'coverage_people', { q: 'kala' })).toEqual([])
      expect((await read(editor, 'coverage_people', { q: 'kala' })).map((p: any) => p.code)).toEqual(['2030'])
    })

    test("a person's identity line names only their job inside the viewer's area, never another store's", async ({ admin, createUser }) => {
      const { floor } = await withTeams(admin, createUser)
      // Asha also manages a Hillview department; her Hillview job sorts first by id.
      await saveRow(admin, 'Job Assignment', { assignment_id: 'A-HIL-DM', employee: '2004', job: 'Department Manager', site: 'HIL', starts_on: '2026-10-01' })
      expect((await read(floor, 'coverage_people', { q: 'asha' })).map((p: any) => p.line)).toEqual(['2004 · Team Leader · Lakeside'])
    })

    test("a moved person's row says who reviews the move", async ({ admin, createUser }) => {
      const { floor, store } = await withTeams(admin, createUser)
      await act(floor, 'move_staff', { job: 'JA-SS', to_section: 'LKS-S2' })
      const staff = (await read(store, 'my_store')).places[0].staff
      expect(staff.find((s: any) => s.job_id === 'JA-SS').waiting_for).toBe('Asha Leader')
      // HR changes who Sundar reports to while the move waits: the row names the new reviewer.
      await sql`update featherbase.job_assignment set reports_to = '2001' where row_id = 'JA-SS'`
      const after = (await read(store, 'my_store')).places[0].staff
      expect(after.find((s: any) => s.job_id === 'JA-SS').waiting_for).toBe('Selvi Store')
    })

    test("a section's page opens for whoever's area holds it, and the master data team", async ({ admin, createUser }) => {
      const { leader, floor, editor } = await withTeams(admin, createUser)
      const own = await read(leader, 'coverage', { section: 'LKS-S1' })
      expect(own).toMatchObject({ state: 'ok', kind: 'section', section: { name: 'Sarees', staff: expect.arrayContaining([expect.objectContaining({ code: '2004', job: 'Team Leader' })]) } })
      expect(await read(leader, 'coverage', { section: 'LKS-S2' })).toEqual({ state: 'not_allowed' })
      expect(await read(floor, 'coverage', { section: 'LKS-S2' })).toMatchObject({ state: 'ok' })
      expect(await read(floor, 'coverage', { section: 'LKS-S3' })).toEqual({ state: 'not_allowed' })
      expect(await read(editor, 'coverage', { section: 'LKS-S4' })).toMatchObject({ state: 'ok', section: { gaps: ['No Team Leader', 'No subcategories'] } })
    })

    test('a record links on Dash only when the viewer may open its page there', async ({ admin, createUser }) => {
      const { floor, editor } = await withTeams(admin, createUser)
      const refs = [{ table: 'Employee', id: '2004' }, { table: 'Employee', id: '2001' }, { table: 'Employee', id: '2030' }, { table: 'Employee', id: '2002' },
        { table: 'Section', id: 'LKS-S1' }, { table: 'Section', id: 'LKS-S3' }, { table: 'Department', id: 'LKS-KIDS' }]
      // Farah (first floor): her Team Leader yes; her Store Manager, the second floor's staff and section, and the department no; herself yes.
      expect(await read(floor, 'dash_pages_open', { refs })).toEqual([true, false, false, true, true, false, false])
      expect(await read(editor, 'dash_pages_open', { refs })).toEqual(refs.map(() => true))
    })

    test('a leaver covers nothing, though their rows are still open', async ({ admin, createUser }) => {
      const { store, editor } = await withDepartment(admin, createUser)
      await sql`update featherbase.employee set status = 'Left' where row_id = '2020'`
      const answer = await read(editor, 'coverage', { employee: '2020' })
      expect(answer).toMatchObject({ jobs: [], merchandise: [], gaps: ['No longer on the staff list (Left): covers nothing'] })
      expect(await read(store, 'coverage', { employee: '2020' })).toEqual({ state: 'not_allowed' })
    })

    test('a named cluster head is shown covering their cluster', async ({ admin, createUser }) => {
      const { editor } = await withDepartment(admin, createUser)
      await saveRow(admin, 'Cluster', { code: 'NORTH', name: 'North' })
      await sql`update featherbase.cluster set cluster_manager = '2020' where row_id = 'NORTH'`
      const answer = await read(editor, 'coverage', { employee: '2020' })
      expect(answer.jobs.map((j: any) => j.job)).toContain('Named head of cluster NORTH')
    })

    test('a buyer\'s merchandise is listed at its deepest level', async ({ admin, createUser }) => {
      const { leader } = await withDepartment(admin, createUser)
      await saveRow(admin, 'Merchandise Assignment', { assignment_id: 'MA-1', employee: '2004', responsibility: 'Buyer', category: 'Girls wear', starts_on: '2026-10-01' })
      const answer = await read(leader, 'coverage', {})
      expect(answer.merchandise).toEqual([expect.objectContaining({ responsibility: 'Buyer', named: 'Girls wear', subcategories: [{ code: '020101001', name: 'Girls frocks' }], gaps: [] })])
    })
  })
})
