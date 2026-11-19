// #1282 G1–G6 (Codex standard round 2): the Admin's area picker keeps a row to pick when the
// count under it may not be read, leaving the count off.
import { describe, expect, test, vi } from 'vitest'

vi.mock('../src/lib/api', () => ({
  api: { get: vi.fn() },
  listResource: vi.fn(async (table: string) => {
    if (table === 'Floor') throw new Error('Forbidden')
    return table === 'Site' ? { data: [{ row_id: 'se', name: 'Store E' }], total: 1 } : { data: [{ row_id: 'cs', name: ' ' }], total: 1 }
  }),
}))
const { areaLoader } = await import('../src/lib/app-areas')

const levels = new Map([
  ['Cluster', { table: 'Cluster', title: 'name', label: 'Cluster', plural: 'clusters' }],
  ['Site', { table: 'Site', title: 'name', parent: 'cluster', label: 'Store', plural: 'stores' }],
  ['Floor', { table: 'Floor', title: 'name', parent: 'site', label: 'Floor', plural: 'floors' }],
])
const axis = { name: 'Location', whole: 'All', levels: [...levels.values()].map(({ table, label, plural }) => ({ table, label, plural })) }

describe("the Admin's area picker", () => {
  test('counts what the viewer may read under a row, its id where it has no name', async () => {
    expect(await areaLoader(levels)(axis, 0, null)).toEqual([{ id: 'cs', name: 'cs', count: 1 }])
  })
  test('keeps a row to pick when the level under it may not be read, with no count', async () => {
    expect(await areaLoader(levels)(axis, 1, { id: 'cs', name: 'Chennai South' })).toEqual([{ id: 'se', name: 'Store E' }])
  })
})
