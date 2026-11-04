import { describe, expect } from 'vitest'
import { test } from './pg-test'

// #795: the list and the form keep one settings record per person and Table;
// each save merges its keys, so neither screen's save drops the other's.

describe('PUT /api/user_settings/:table merges top-level keys', () => {
  test("a list save keeps the form's arrangement, and the other way round", async ({ admin }) => {
    const path = '/api/user_settings/Merge%20Probe'
    await admin.put(path, { form: { mode: 'type', columns: 1 } })
    await admin.put(path, { sort: null, shownCols: ['a'], hiddenCols: [] })
    let stored = await admin.get<{ settings: Record<string, unknown> }>(path)
    expect(stored.settings).toEqual({ form: { mode: 'type', columns: 1 }, sort: null, shownCols: ['a'], hiddenCols: [] })

    await admin.put(path, { form: { mode: 'links', columns: 2 } })
    stored = await admin.get<{ settings: Record<string, unknown> }>(path)
    expect(stored.settings).toEqual({ form: { mode: 'links', columns: 2 }, sort: null, shownCols: ['a'], hiddenCols: [] })
  })

  test("one person's arrangement never reaches another's", async ({ admin, createUser }) => {
    const path = '/api/user_settings/Merge%20Probe%20Two'
    await admin.put(path, { form: { mode: 'type', columns: 1 } })
    const other = await createUser({ roles: [] })
    expect((await other.get<{ settings: unknown }>(path)).settings).toBeNull()
  })
})
