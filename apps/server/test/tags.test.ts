import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// UI-017: document tags add/list/remove, gated by document read permission.

const DT = 'Tag Srv DT'

// Each test builds its DocType + document inside its own sandbox transaction.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    autoname: 'prompt',
    fields: [{ fieldname: 'title', fieldtype: 'Data' }],
  })
  await admin.post(`/api/resource/${encodeURIComponent(DT)}`, { name: 't1', title: 'x' })
}

describe('UI-017: tags', () => {
  test('adds, lists, and removes tags', async ({ admin }) => {
    await setup(admin)
    for (const tag of ['urgent', 'finance']) {
      const res = await admin.fetch('/api/tags', {
        method: 'POST',
        body: JSON.stringify({ doctype: DT, name: 't1', tag }),
      })
      expect(res.status).toBe(201)
    }
    const listed = await admin.get<{ tags: string[] }>(`/api/tags/${encodeURIComponent(DT)}/t1`)
    expect(listed.tags).toEqual(['finance', 'urgent']) // sorted

    // Duplicate is a no-op, not an error.
    const dup = await admin.fetch('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, name: 't1', tag: 'urgent' }),
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
      body: JSON.stringify({ doctype: DT, name: 'ghost', tag: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  test('requires a non-empty tag', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, name: 't1', tag: '  ' }),
    })
    expect(res.status).toBe(417)
  })
})
