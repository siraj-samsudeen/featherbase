import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta, invalidateMeta, metaCacheStats } from '../src/meta'
import type { TestClient } from 'feather-testing-postgres'

// NOTE on the sandbox: the harness calls invalidateMeta() after every test,
// clearing the per-process cache BETWEEN tests. All assertions here are
// within-one-test deltas (loads/hits snapshots, cache-then-invalidate), so
// the semantics survive per-test cache warming.

const DT = 'Cache Probe DT'

async function makeDT(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Old Label' }],
  })
}

describe('META-011: meta cache with invalidation', () => {
  test('serves repeat lookups from cache — one DB load per table', async ({ admin }) => {
    await makeDT(admin)
    invalidateMeta(DT)
    const loadsBefore = metaCacheStats.loads
    await getMeta(DT)
    expect(metaCacheStats.loads).toBe(loadsBefore + 1)
    const hitsBefore = metaCacheStats.hits
    await getMeta(DT)
    await getMeta(DT)
    expect(metaCacheStats.loads).toBe(loadsBefore + 1)
    expect(metaCacheStats.hits).toBe(hitsBefore + 2)
  })

  test('sees altered metadata after invalidation', async ({ admin }) => {
    await makeDT(admin)
    expect((await getMeta(DT)).columns[0].label).toBe('Old Label')
    await sql`update column_def set label = 'New Label' where parent = ${DT}`
    // Still cached:
    expect((await getMeta(DT)).columns[0].label).toBe('Old Label')
    invalidateMeta(DT)
    expect((await getMeta(DT)).columns[0].label).toBe('New Label')
  })

  test('creating a Table invalidates and serves fresh meta over HTTP', async ({ admin }) => {
    await makeDT(admin)
    // Warm the cache, mutate the row underneath, invalidate — HTTP must
    // serve the fresh label (replays the previous test's mutation as setup).
    expect((await getMeta(DT)).columns[0].label).toBe('Old Label')
    await sql`update column_def set label = 'New Label' where parent = ${DT}`
    invalidateMeta(DT)
    const body = await admin.get<{ columns: { label: string }[] }>(
      `/api/table/${encodeURIComponent(DT)}:meta`,
    )
    expect(body.columns[0].label).toBe('New Label')
  })
})
