// Sales-target scoping reads the person's current `stylehr-employee-code`
// identifier rows (#408, person-resolution task 2.1), so the manual procedures
// move Sections with no copy in between: a joiner recorded by hand sees their
// Sections, and a corrected code moves them to the right person.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { seedSalesTarget } from '../src/sales-target'
import { applySeedPack } from '../src/seed-packs'
import { configureDelegated } from './identity-fixtures'
import { makePerson } from './fixtures'
import { app } from '../src/index'
import { issueSession } from '../src/auth'

const savedToday = process.env.SALES_TARGET_TODAY
beforeAll(() => { process.env.SALES_TARGET_TODAY = '2026-09-17' })
afterAll(() => {
  if (savedToday === undefined) delete process.env.SALES_TARGET_TODAY
  else process.env.SALES_TARGET_TODAY = savedToday
})

const CODE = 'stylehr-employee-code'

/** The sales-target Tables, the Store
 *  Sections maps with RR-0103 owning Kurti at ATK, and the freeze: the
 *  roster sync has written no code yet. */
async function setUp(admin: TestClient) {
  await seedSalesTarget((path, init) => admin.fetch(path, init), { test_employee_1: 'pw-1', test_employee_2: 'pw-2', test_employee_3: 'pw-3', test_employee_4: 'pw-4' }, [
    { username: 'test_employee_1', display_name: 'Employee 1', plant_code: '1501', store_label: 'ATK', material_groups: ['010101001'] },
  ])
  for (const [name, columns] of [
    ['Section Merchandise Map', ['store_code', 'material_group', 'mch_subcategory', 'section_name']],
    ['Employee Section Map', ['store_code', 'employee_code', 'subcategory', 'section_name']],
  ] as const)
    if ((await admin.fetch(`/api/table/${encodeURIComponent(name)}:meta`)).status === 404)
      await admin.post('/api/table_def', { name, module: 'Store Sections', columns: columns.map((c) => ({ column_name: c, column_type: 'Data' })) })
  for (const row of [
    { store_code: '1501', material_group: '010505001', mch_subcategory: 'Kurti', section_name: 'Kurti' },
    { store_code: '1501', material_group: '010505002', mch_subcategory: 'Kurti Set', section_name: 'Kurti' },
  ])
    await admin.post('/api/save_row', { table: 'Section Merchandise Map', row })
  for (const row of [
    { store_code: '1501', employee_code: 'RR-0103', subcategory: 'Kurti', section_name: 'Kurti' },
    { store_code: '1501', employee_code: 'RR-0103', subcategory: 'Kurti Set', section_name: 'Kurti' },
  ])
    await admin.post('/api/save_row', { table: 'Employee Section Map', row })
  await applySeedPack('jeyarama')
  await sql`delete from person_identifier where system = ${CODE} and source = 'stylehr-roster-sync'`
}

const groupsOf = async (person: string) => {
  const client = makeClient(app, (await issueSession(person)).token, person)
  const answer = await client.get<{ assignment: { material_groups: string[] } | null }>('/api/sales_target/me')
  return answer.assignment?.material_groups ?? []
}

describe('the manual procedures move Sections through identifier rows', () => {
  test('a joiner recorded by hand sees their Sections, and the picker finds them by that code', async ({ admin }) => {
    await setUp(admin)
    const joiner = await makePerson({ full_name: 'Joiner Jaya', roles: [{ role: 'Sales Target Viewer' }] })
    expect(await groupsOf(joiner)).toEqual([])
    await admin.post(`/api/people/${joiner}/identifiers`, { system: CODE, value: 'rr-0103', note: 'Joiner, HR mail 23-Oct' })
    expect(await groupsOf(joiner)).toEqual(['010505001', '010505002'])
    const picked = (await admin.get<{ people: { row_id: string; label: string }[] }>('/api/people/pick?q=rr-0103')).people
    expect(picked).toEqual([{ row_id: joiner, label: 'Joiner Jaya · RR-0103' }])
  })

  test('a correction moves the Sections: the wrong holder loses them, the right one gains them', async ({ admin }) => {
    await setUp(admin)
    const wrong = await makePerson({ full_name: 'Wrong Holder', roles: [{ role: 'Sales Target Viewer' }] })
    const right = await makePerson({ full_name: 'Right Holder', roles: [{ role: 'Sales Target Viewer' }] })
    const { identifier } = await admin.post<{ identifier: { id: string } }>(`/api/people/${wrong}/identifiers`, { system: CODE, value: 'RR-0103', note: 'as mailed' })
    expect(await groupsOf(wrong)).toEqual(['010505001', '010505002'])
    // Recorded today and ended today: never in force, so it goes, and so do the Sections.
    const ended = await admin.fetch(`/api/identifiers/${identifier.id}`, { method: 'PATCH', body: JSON.stringify({ end: true, note: 'Wrong person; HR mail 23-Oct' }) })
    expect(ended.status).toBe(200)
    expect(await groupsOf(wrong)).toEqual([])
    await admin.post(`/api/people/${right}/identifiers`, { system: CODE, value: 'RR-0103', note: 'Corrected; HR mail 23-Oct' })
    expect(await groupsOf(right)).toEqual(['010505001', '010505002'])
  })
})

describe('a record number someone else holds (review on #385)', () => {
  test('linking it answers 409, not 500, and links nothing', async ({ admin }) => {
    await configureDelegated()
    const holder = await makePerson({ full_name: 'Record Holder' })
    const other = await makePerson({ full_name: 'Record Taker' })
    await sql`insert into person_identifier (id, person_id, system, value, one_holder, source, recorded_by)
      values ('pid_heldrecord1aaaaaaaaa', ${holder}, 'stylehr-employee-id', '55555', true, 'test', 'test')`
    const res = await admin.fetch(`/api/people/${other}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: '55555', sign_in_name: 'taker' }) })
    expect(res.status).toBe(409)
    expect(await sql`select 1 from sign_in_identity where person_id = ${other}`).toHaveLength(0)
  })
})
