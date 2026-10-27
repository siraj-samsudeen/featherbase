// #330: the summary view's counts and sums come from the server over every
// matching row, not from the rows the browser happened to fetch.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, expectApiError } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'

const T = 'Summary Test Sale'
const ENC = encodeURIComponent(T)

type Summary = {
  count: number
  sums: Record<string, string>
  groups: { value: string | null; count: number; sums: Record<string, string> }[]
}

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'region', column_type: 'Choice', choices: 'North\nSouth' },
      { column_name: 'qty', column_type: 'Int' },
      { column_name: 'amount', column_type: 'Currency' },
      { column_name: 'note', column_type: 'Data' },
    ],
  })
  for (const [region, qty, amount] of [
    ['North', 1, '10.50'],
    ['North', 2, '0.25'],
    ['South', 5, '100'],
    [null, 7, '1'],
  ] as const)
    await admin.post('/api/save_row', { table: T, row: { region, qty, amount } })
}

const summaryPath = (params: Record<string, string>) => `/api/table/${ENC}:summary?${new URLSearchParams(params)}`

describe('summary totals over every matching row', () => {
  test('the overall count and sums cover every matching row', async ({ admin }) => {
    await setup(admin)
    const res = await admin.get<Summary>(summaryPath({ sums: JSON.stringify(['qty', 'amount']) }))
    expect(res.count).toBe(4)
    expect(Number(res.sums.qty)).toBe(15)
    expect(Number(res.sums.amount)).toBe(111.75)
    expect(res.groups).toEqual([])
  })

  test('each group has its own count and sums, in the order the list sorts them, empty last', async ({ admin }) => {
    await setup(admin)
    const res = await admin.get<Summary>(summaryPath({ group_by: 'region', sums: JSON.stringify(['qty']) }))
    expect(res.groups.map((g) => [g.value, g.count, Number(g.sums.qty)])).toEqual([
      ['North', 2, 3],
      ['South', 1, 5],
      [null, 1, 7],
    ])
    expect(res.count).toBe(4)
  })

  test('filters narrow the totals the same way they narrow the list', async ({ admin }) => {
    await setup(admin)
    const res = await admin.get<Summary>(
      summaryPath({ filters: JSON.stringify([['qty', '>=', 2]]), group_by: 'region', sums: JSON.stringify(['qty']) }),
    )
    expect(res.count).toBe(3)
    expect(Number(res.sums.qty)).toBe(14)
    expect(res.groups.map((g) => g.value)).toEqual(['North', 'South', null])
  })

  test('the totals are not capped at the 500 rows a list page returns', async ({ admin }) => {
    await admin.post('/api/table_def', { name: T, columns: [{ column_name: 'qty', column_type: 'Int' }] })
    for (let i = 0; i < 501; i++) await admin.post('/api/save_row', { table: T, row: { qty: 2 } })
    const page = await admin.get<{ data: unknown[]; total: number }>(`/api/table/${ENC}?limit_page_length=1000`)
    expect(page.data).toHaveLength(500)
    const res = await admin.get<Summary>(summaryPath({ sums: JSON.stringify(['qty']) }))
    expect(res.count).toBe(501)
    expect(Number(res.sums.qty)).toBe(1002)
  }, 30_000) // 501 saves, one HTTP call each: about 5 s on CI, over the 5 s default

  test('a Currency sum keeps every stored decimal', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: T, row: { region: 'South', qty: 0, amount: '0.000000001' } })
    const res = await admin.get<Summary>(summaryPath({ sums: JSON.stringify(['amount']) }))
    expect(res.sums.amount).toBe('111.750000001')
  })

  test('only a number column can be summed, and only a real column grouped', async ({ admin }) => {
    await setup(admin)
    await expectApiError(admin.get(summaryPath({ sums: JSON.stringify(['note']) })), { status: 417 })
    await expectApiError(admin.get(summaryPath({ group_by: 'nope' })), { status: 417 })
    await expectApiError(admin.get(summaryPath({ sums: 'qty' })), { status: 400 })
    await expectApiError(admin.get(summaryPath({ filters: 'not-json' })), { status: 400 })
  })

  test('a person who can read only their own rows gets totals over only those rows', async ({ admin, createUser }) => {
    await setup(admin)
    const reader = await createUserWithRole(admin, createUser, {
      role: 'Summary Own Reader', table: T, can_read: true, can_write: true, can_create: true, own_rows_only: true,
    })
    await reader.post('/api/save_row', { table: T, row: { region: 'South', qty: 4 } })
    const res = await reader.get<Summary>(summaryPath({ group_by: 'region', sums: JSON.stringify(['qty']) }))
    expect(res.count).toBe(1)
    expect(Number(res.sums.qty)).toBe(4)
    expect(res.groups.map((g) => [g.value, g.count])).toEqual([['South', 1]])
  })

  test('someone who cannot read the Table is refused', async ({ admin, createUser }) => {
    await setup(admin)
    const outsider = await createUser()
    await expectApiError(outsider.get(summaryPath({})), { status: 403 })
  })
})
