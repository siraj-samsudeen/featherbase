// #738 (list-columns-from-the-table, Decision 2): the :meta response carries
// the caller's readable levels, so the list never offers a column the caller
// may not read. The meta itself stays cached per Table, shared by everyone.

import { expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, makeTable } from './fixtures'
import { getMeta } from '../src/meta'

const DT = 'Rt Salary'

async function salaryTable(admin: Parameters<typeof makeTable>[0]) {
  return makeTable(admin, {
    name: DT,
    columns: ['employee', { column_name: 'salary', column_type: 'Currency', tier: 'restricted' }],
  })
}

test('a caller who may read only basic columns is told so', async ({ admin, createUser }) => {
  const dt = await salaryTable(admin)
  const user = await createUserWithRole(admin, createUser, {
    role: 'Rt Basic Reader',
    table: DT,
    tier: 'basic',
    can_read: true,
  })
  const meta = await user.get<{ readable_tiers: string[] }>(dt.metaUrl)
  expect(meta.readable_tiers).toEqual(['basic'])
})

test('a caller who may read restricted columns is told both levels', async ({ admin }) => {
  const dt = await salaryTable(admin)
  const meta = await admin.get<{ readable_tiers: string[] }>(dt.metaUrl)
  expect([...meta.readable_tiers].sort()).toEqual(['basic', 'restricted'])
})

test("the caller's levels never reach the cached meta", async ({ admin }) => {
  const dt = await salaryTable(admin)
  await admin.get(dt.metaUrl)
  expect('readable_tiers' in (await getMeta(DT))).toBe(false)
})
