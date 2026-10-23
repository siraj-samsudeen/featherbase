// The employee_code mirror (final review round on #385): until task 2.1 moves
// sales-target scoping onto identifier rows, every write of a current
// `stylehr-employee-code` row copies the person's current code into the
// `employee_code` Custom Field that scoping still reads. So a joiner recorded
// by hand sees their Sections, and a corrected code moves the Sections to the
// right person.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { currentAssignment, seedSalesTarget } from '../src/sales-target'
import { applySeedPack } from '../src/seed-packs'
import { configureDelegated } from './identity-fixtures'
import { makePerson } from './fixtures'

const savedToday = process.env.SALES_TARGET_TODAY
beforeAll(() => { process.env.SALES_TARGET_TODAY = '2026-09-17' })
afterAll(() => {
  if (savedToday === undefined) delete process.env.SALES_TARGET_TODAY
  else process.env.SALES_TARGET_TODAY = savedToday
})

const CODE = 'stylehr-employee-code'

/** The sales-target Tables (and the employee_code Custom Field), the Store
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

const groupsOf = async (person: string) => (await currentAssignment(person))?.material_groups ?? []
const fieldOf = async (person: string) => (await sql`select employee_code from person where row_id = ${person}`)[0].employee_code

describe('the employee_code mirror (until task 2.1)', () => {
  test('a joiner recorded by hand sees their Sections, and the picker finds them by that code', async ({ admin }) => {
    await setUp(admin)
    const joiner = await makePerson({ full_name: 'Joiner Jaya' })
    expect(await groupsOf(joiner)).toEqual([])
    await admin.post(`/api/people/${joiner}/identifiers`, { system: CODE, value: 'rr-0103', note: 'Joiner, HR mail 23-Oct' })
    expect(await fieldOf(joiner)).toBe('RR-0103')
    expect(await groupsOf(joiner)).toEqual(['010505001', '010505002'])
    const picked = (await admin.get<{ people: { row_id: string; label: string }[] }>('/api/people/pick?q=rr-0103')).people
    expect(picked).toEqual([{ row_id: joiner, label: 'Joiner Jaya · RR-0103' }])
  })

  test('a correction moves the Sections: the wrong holder loses them, the right one gains them', async ({ admin }) => {
    await setUp(admin)
    const wrong = await makePerson({ full_name: 'Wrong Holder' })
    const right = await makePerson({ full_name: 'Right Holder' })
    const { identifier } = await admin.post<{ identifier: { id: string } }>(`/api/people/${wrong}/identifiers`, { system: CODE, value: 'RR-0103', note: 'as mailed' })
    expect(await groupsOf(wrong)).toEqual(['010505001', '010505002'])
    // Recorded today and ended today: never in force, so it goes; the mirror clears.
    const ended = await admin.fetch(`/api/identifiers/${identifier.id}`, { method: 'PATCH', body: JSON.stringify({ end: true, note: 'Wrong person; HR mail 23-Oct' }) })
    expect(ended.status).toBe(200)
    expect(await fieldOf(wrong)).toBeNull()
    expect(await groupsOf(wrong)).toEqual([])
    await admin.post(`/api/people/${right}/identifiers`, { system: CODE, value: 'RR-0103', note: 'Corrected; HR mail 23-Oct' })
    expect(await fieldOf(right)).toBe('RR-0103')
    expect(await groupsOf(right)).toEqual(['010505001', '010505002'])
  })

  test('ending a carried-over code clears the field; a second current code keeps the most recent', async ({ admin }) => {
    await setUp(admin)
    const p = await makePerson({ full_name: 'Two Codes' })
    await sql`update person set employee_code = 'RR-1' where row_id = ${p}`
    const [old] = await sql`insert into person_identifier (id, person_id, system, value, valid, verified, one_holder, source, recorded_by)
      values ('pid_mirrorold1aaaaaaaaaaa', ${p}, ${CODE}, 'RR-1', daterange('2024-01-01', null, '[)'), true, true, 'migration', 'migration') returning id`
    await admin.post(`/api/people/${p}/identifiers`, { system: CODE, value: 'RR-2', note: 'second payroll' })
    expect(await fieldOf(p)).toBe('RR-2')
    await admin.fetch(`/api/identifiers/${String(old.id)}`, { method: 'PATCH', body: JSON.stringify({ end: true, note: 'left the agency' }) })
    expect(await fieldOf(p)).toBe('RR-2')
    const [rr2] = await sql`select id from person_identifier where person_id = ${p} and value = 'RR-2'`
    await admin.fetch(`/api/identifiers/${String(rr2.id)}`, { method: 'DELETE' })
    expect(await fieldOf(p)).toBeNull()
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
