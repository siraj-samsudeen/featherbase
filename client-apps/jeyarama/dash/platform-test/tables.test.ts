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
})
