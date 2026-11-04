// The org chart Tables' save rules on the real platform: the app's validators
// run on every save, and the key columns they write make names unique within
// a store. Made-up stores 9901 and 9902.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test as pgTest } from '../pg-test'
import { expectApiError } from '../fixtures'
import { installApp as install, pinned, saveRow } from './helpers'

const test = pgTest.extend<{ admin: TestClient }>({ admin: async ({ admin }, use) => use(pinned(admin)) })
const save = (admin: TestClient, table: string, row: Record<string, unknown>) => saveRow(admin, table, row)

describe('the org chart Tables on save', () => {
  test('a second section with the same name in a store is refused', async ({ admin }) => {
    await install(admin)
    await save(admin, 'section', { store: '9901', section_name: 'Women Tops' })
    await expectApiError(save(admin, 'section', { store: '9901', section_name: 'women tops ' }), { status: 417, message: expect.stringMatching(/Duplicate/) })
  })

  test('the same section name in two stores is two sections', async ({ admin }) => {
    await install(admin)
    await save(admin, 'section', { store: '9901', section_name: 'Women Tops' })
    const other = await save(admin, 'section', { store: '9902', section_name: 'Women Tops' })
    expect(other.section_key).toBe('9902/women tops')
  })

  test('a section allows one Team Leader unless told otherwise', async ({ admin }) => {
    await install(admin)
    const section = await save(admin, 'section', { store: '9901', section_name: 'Sarees' })
    expect(Number(section.team_leaders_allowed)).toBe(1)
  })

  test('two unnamed departments in one store are accepted', async ({ admin }) => {
    await install(admin)
    await save(admin, 'department', { store: '9901', department_key: 'dm-P-107' })
    const second = await save(admin, 'department', { store: '9901', department_key: 'dm-P-108' })
    expect(second.display_name).toBe('dm-P-108')
  })

  test('a department name given twice in one store is refused', async ({ admin }) => {
    await install(admin)
    await save(admin, 'department', { store: '9901', department_key: 'dm-P-107', name: 'Ladies Ethnic' })
    await expectApiError(save(admin, 'department', { store: '9901', department_key: 'dm-P-108', name: 'Ladies Ethnic' }), { status: 417, message: expect.stringMatching(/Duplicate/) })
  })

  test('a store code padded with spaces is refused, not stored', async ({ admin }) => {
    await install(admin)
    await expectApiError(save(admin, 'section', { store: ' 9901 ', section_name: 'Sarees' }), { status: 417, message: expect.stringMatching(/exactly four digits/) })
  })

  test('a Team Leader without a section is refused', async ({ admin, createUser }) => {
    await install(admin)
    const person = await createUser({ email: 'p-101@example.test' })
    await expectApiError(save(admin, 'job_assignment', {
      person: person.user, job: 'Team Leader', store: '9901', starts_on: '2026-07-01' }), { status: 417 })
  })

  test('a Cluster Manager without a cluster is refused', async ({ admin, createUser }) => {
    await install(admin)
    const person = await createUser({ email: 'p-102@example.test' })
    await expectApiError(save(admin, 'job_assignment', {
      person: person.user, job: 'Cluster Manager', store: '9901', starts_on: '2026-07-01' }), { status: 417, message: expect.stringMatching(/needs the cluster/) })
  })

  test('a job assignment is Primary and takes all of the time unless told otherwise, with its designation beside the job', async ({ admin, createUser }) => {
    await install(admin)
    const person = await createUser({ email: 'p-103@example.test' })
    const title = await save(admin, 'designation', { title: 'Store Manager - Grade 1' })
    const row = await save(admin, 'job_assignment', { person: person.user, job: 'Store Manager', designation: title.row_id, store: '9901', starts_on: '2026-07-01' })
    expect(row).toMatchObject({ assignment_type: 'Primary', designation: title.row_id })
    expect(Number(row.percentage)).toBe(100)
  })

  test('a designation is in the list once, whatever its spacing or case', async ({ admin }) => {
    await install(admin)
    const title = await save(admin, 'designation', { title: 'Assistant Manager' })
    expect(title.title_key).toBe('assistant manager')
    await expectApiError(save(admin, 'designation', { title: ' assistant  MANAGER' }), { status: 417, message: expect.stringMatching(/Duplicate/) })
    const alias = await save(admin, 'designation_alias', { source: 'hr', alias: 'ASST MGR', designation: title.row_id })
    expect(alias.alias_key).toBe('hr/asst mgr')
  })

  test('a section approved for more people than its maximum is refused', async ({ admin }) => {
    await install(admin)
    const section = await save(admin, 'section', { store: '9901', section_name: 'Formal Shirts', approved_headcount_min: 15, approved_headcount_max: 19 })
    expect([Number(section.approved_headcount_min), Number(section.approved_headcount_max)]).toEqual([15, 19])
    await expectApiError(save(admin, 'section', { store: '9901', section_name: 'Cookware', approved_headcount_min: 8, approved_headcount_max: 7 }),
      { status: 417, message: expect.stringMatching(/maximum is at least its minimum/) })
  })
})

describe('employment on save', () => {
  async function employee(admin: TestClient, createUser: (o: { email: string }) => Promise<{ user: string }>, n: string) {
    const person = await createUser({ email: `emp-${n}@example.test` })
    return save(admin, 'employee', { person: person.user, name: `Made-up Person ${n}` })
  }

  test('a rejoin is a new stint, which may carry a new number', async ({ admin, createUser }) => {
    await install(admin)
    const one = await employee(admin, createUser, '201')
    await save(admin, 'employment', { employee: one.row_id, legal_company: 'DEMO-CO', employee_number: 'DEMO-0201', joined_on: '2024-10-09', left_on: '2026-01-22', leaving_reason: 'Resigned' })
    const rejoin = await save(admin, 'employment', { employee: one.row_id, legal_company: 'DEMO-CO', employee_number: 'DEMO-0299', joined_on: '2026-02-04' })
    expect(rejoin.left_on).toBeNull()
  })

  test('a stint that overlaps another at the same company is refused', async ({ admin, createUser }) => {
    await install(admin)
    const one = await employee(admin, createUser, '202')
    await save(admin, 'employment', { employee: one.row_id, legal_company: 'DEMO-CO', employee_number: 'DEMO-0202', joined_on: '2024-10-09' })
    await expectApiError(save(admin, 'employment', { employee: one.row_id, legal_company: 'DEMO-CO', employee_number: 'DEMO-0202', joined_on: '2026-02-04' }),
      { status: 417, message: expect.stringMatching(/overlaps the person's stint at DEMO-CO from 09-Oct-2024, still current/) })
    const other = await save(admin, 'employment', { employee: one.row_id, legal_company: 'DEMO-CO2', employee_number: 'X-1', joined_on: '2026-02-04' })
    expect(other.legal_company).toBe('DEMO-CO2')
  })

  test('one company\'s employee number never names two people', async ({ admin, createUser }) => {
    await install(admin)
    const [one, two] = [await employee(admin, createUser, '203'), await employee(admin, createUser, '204')]
    await save(admin, 'employment', { employee: one.row_id, legal_company: 'DEMO-CO', employee_number: 'DEMO-0203', joined_on: '2024-10-09' })
    await expectApiError(save(admin, 'employment', { employee: two.row_id, legal_company: 'DEMO-CO', employee_number: 'DEMO-0203', joined_on: '2025-01-01' }),
      { status: 417, message: expect.stringMatching(/already belongs to another person/) })
  })

  test('an end on or before the start is refused', async ({ admin, createUser }) => {
    await install(admin)
    const one = await employee(admin, createUser, '205')
    await expectApiError(save(admin, 'employment', { employee: one.row_id, legal_company: 'DEMO-CO', employee_number: 'DEMO-0205', joined_on: '2026-01-01', left_on: '2026-01-01' }),
      { status: 417, message: expect.stringMatching(/left_on must come after joined_on/) })
  })
})
