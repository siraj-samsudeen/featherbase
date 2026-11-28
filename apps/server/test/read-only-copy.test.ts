// #1418: read-only copies, beyond the bound scenarios (test/scenarios/
// read-only-copies.test.ts): the declaration's rules, the storage, every way
// a load is refused, the schedule's branches and the new-load context.
import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'
import { test } from './pg-test'
import { APP, LINES, Warehouse, forecastLines, install, load, removeFolders, rows, writeApp } from './read-only-copy-app'

const warehouse = new Warehouse('b4_copy_unit')
beforeAll(() => warehouse.create())
afterAll(() => warehouse.drop())
afterEach(removeFolders)

describe('a read-only copy', () => {
  test('installs as a Table, then loads the official run', async ({ admin }) => {
    await install(admin, await writeApp([forecastLines(warehouse.schema)]))
    await warehouse.publish('Dec-1', [['Dec-1', 'LKS', 'GJ01', '2026-12-01', '1234567890123.45']])
    const outcome = await load(LINES)
    expect(outcome).toMatchObject({ status: 'loaded', rows: 1, previous: null })
    expect(await rows(LINES)).toMatchObject([{ row_id: 'LKS·GJ01·2026-12-01', run_id: 'Dec-1', value: '1234567890123.45' }])
    expect(await admin.get(`/api/table/${encodeURIComponent(LINES)}/${encodeURIComponent('LKS·GJ01·2026-12-01')}`))
      .toMatchObject({ store_code: 'LKS', value: '1234567890123.45' })
    expect(APP).toBe('copyproof')
  })
})
