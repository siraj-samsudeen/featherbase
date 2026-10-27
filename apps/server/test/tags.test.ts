import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// UI-017: document tags add/list/remove, gated by document read permission.
//
const DT = 'Tag Srv DT'

// Each test builds its Table + document inside its own sandbox transaction.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 't1', title: 'x' })
}

describe('UI-017: tags', () => {
  test('adds, lists, and removes tags', async ({ admin }) => {
    await setup(admin)
    for (const tag of ['urgent', 'finance']) {
      const res = await admin.fetch('/api/tags', {
        method: 'POST',
        body: JSON.stringify({ table: DT, row_id: 't1', tag }),
      })
      expect(res.status).toBe(201)
    }
    const listed = await admin.get<{ tags: string[] }>(`/api/tags/${encodeURIComponent(DT)}/t1`)
    expect(listed.tags).toEqual(['finance', 'urgent']) // sorted

    // Duplicate is a no-op, not an error.
    const dup = await admin.fetch('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ table: DT, row_id: 't1', tag: 'urgent' }),
    })
    expect(dup.status).toBe(201)
    const after = await admin.get<{ tags: string[] }>(`/api/tags/${encodeURIComponent(DT)}/t1`)
    expect(after.tags).toHaveLength(2)

    const del = await admin.fetch(`/api/tags/${encodeURIComponent(DT)}/t1/urgent`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(200)
    const final = await admin.get<{ tags: string[] }>(`/api/tags/${encodeURIComponent(DT)}/t1`)
    expect(final.tags).toEqual(['finance'])
  })

  test('rejects tagging a document that does not exist (404)', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ table: DT, row_id: 'ghost', tag: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  test('requires a non-empty tag', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ table: DT, row_id: 't1', tag: '  ' }),
    })
    expect(res.status).toBe(417)
  })
})

describe('Tag a row freely', () => {
  async function world(admin: TestClient) {
    await setup(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Tag Srv Reader' } })
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: DT, role: 'Tag Srv Reader', tier: 'basic', can_read: true },
    })
  }
  const tagPath = `/api/tags/${encodeURIComponent(DT)}/t1`

  test('a tag one reader adds is seen, and can be removed, by another reader', async ({ admin, createUser }) => {
    await world(admin)
    const first = await createUser({ roles: ['Tag Srv Reader'] })
    const second = await createUser({ roles: ['Tag Srv Reader'] })
    expect((await first.fetch('/api/tags', { method: 'POST', body: JSON.stringify({ table: DT, row_id: 't1', tag: 'urgent' }) })).status).toBe(201)
    expect((await second.get<{ tags: string[] }>(tagPath)).tags).toEqual(['urgent'])
    expect((await second.fetch(`${tagPath}/urgent`, { method: 'DELETE' })).status).toBe(200)
    expect((await first.get<{ tags: string[] }>(tagPath)).tags).toEqual([])
  })

  test('someone who cannot read the row can neither see nor change its tags', async ({ admin, createUser }) => {
    await world(admin)
    const outsider = await createUser({ roles: [] })
    expect((await outsider.fetch(tagPath)).status).toBe(403)
    expect((await outsider.fetch('/api/tags', { method: 'POST', body: JSON.stringify({ table: DT, row_id: 't1', tag: 'x' }) })).status).toBe(403)
  })
})
