import { describe, expect } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { grantRole } from './fixtures'
import { sameStoredValue } from '../src/permissions'

// #917: a Column reached only through a creator-scoped grant is read only on
// the caller's own rows, on every path that returns or matches its values.
const DT = 'Cr Note'
const ROLE = 'Cr Note Reader'

async function setup(admin: TestClient, createUser: CreateUserFn) {
  await admin.post('/api/table_def', { name: DT, title_column: 'secret', columns: [
    { column_name: 'code', column_type: 'Data' },
    { column_name: 'secret', column_type: 'Data', tier: 'restricted' },
  ] })
  await grantRole(admin, { table: DT, role: ROLE, can_read: true, can_create: true })
  await grantRole(admin, { table: DT, role: ROLE, tier: 'restricted', own_rows_only: true, can_read: true })
  const theirs = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { code: 'A-1', secret: 'hidden-alpha' } })
  const user = await createUser({ roles: [ROLE] })
  return { theirs: theirs.row_id, user }
}

describe('creator-scoped Columns', () => {
  test("another creator's restricted title is not a row title", async ({ admin, createUser }) => {
    const { theirs, user } = await setup(admin, createUser)
    const { titles } = await user.post<{ titles: { title: string }[] }>('/api/row_titles', { rows: [{ table: DT, row_id: theirs }] })
    expect(titles.map((t) => t.title)).not.toContain('hidden-alpha')
  })

  test("search neither shows nor matches another creator's restricted title", async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    const { results } = await user.get<{ results: unknown[] }>('/api/search?q=hidden')
    expect(JSON.stringify(results)).not.toContain('hidden-alpha')
  })

  test("import key analysis cannot probe another creator's restricted values", async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    const report = await user.post<{ key_candidates: { column: string }[] }>(`/api/table/${encodeURIComponent(DT)}:import`, {
      analyze_keys: true, columns: ['secret'], rows: [{ secret: 'hidden-alpha' }],
    })
    expect(report.key_candidates).toEqual([])
  })
})

describe('an unchanged value is not a change', () => {
  test.for([
    ['Currency', 10, '10.00'],
    ['Int', '7', 7],
    ['Check', true, '1'],
    ['Date', '2026-11-04', new Date('2026-11-04T00:00:00Z')],
    ['Data', '', null],
  ] as const)('%s %o equals stored %o', ([type, submitted, stored]) => {
    expect(sameStoredValue(type, submitted, stored)).toBe(true)
  })

  test.for([
    ['Currency', 11, '10.00'],
    ['Check', false, '1'],
    ['Data', 'x', null],
    ['Data', 'x', undefined],
  ] as const)('%s %o differs from stored %o', ([type, submitted, stored]) => {
    expect(sameStoredValue(type, submitted, stored)).toBe(false)
  })
})
