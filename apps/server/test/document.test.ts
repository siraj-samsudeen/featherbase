import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Doc Test Note'

// Each test creates its Table inside its OWN transaction — the sandbox
// rolls it back, so there is no shared beforeAll state and no cleanup.
async function makeDT(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'qty', column_type: 'Int' },
    ],
  })
}

describe('DOC-001: save_row inserts through the Document engine', () => {
  test('inserts, auto-populates standard columns, and is readable back', async ({ admin }) => {
    await makeDT(admin)
    const doc = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: DT,
      row: { title: 'hello', qty: 3 },
    })
    expect(doc.row_id).toBeTruthy()
    expect(doc.created_by).toBe('Administrator')
    expect(doc.created_at).toBeTruthy()
    expect(doc.updated_at).toBeTruthy()
    expect(doc.status).toBe('draft')
    expect(doc.title).toBe('hello')
    expect(doc.qty).toBe('3')

    const read = await admin.get<Record<string, unknown>>(
      `/api/table/${encodeURIComponent(DT)}/${doc.row_id}`,
    )
    expect(read.title).toBe('hello')
  })

  test('rejects unknown fields with a field-wise error', async ({ admin }) => {
    await makeDT(admin)
    await expect(
      admin.post('/api/save_row', { table: DT, row: { title: 'x', nope: 1 } }),
    ).rejects.toMatchObject({
      status: 417,
      fields: { nope: expect.stringMatching(/Unknown field/) },
    })
  })

  test('404s for unknown table and unknown doc', async ({ admin }) => {
    await makeDT(admin)
    await expect(
      admin.post('/api/save_row', { table: 'Missing DT', row: {} }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(admin.get(`/api/table/${encodeURIComponent(DT)}/zzz`)).rejects.toMatchObject({
      status: 404,
    })
  })

  test('rejects malformed envelope', async ({ admin }) => {
    await expect(admin.post('/api/save_row', { row: { a: 1 } })).rejects.toMatchObject({
      status: 417,
    })
  })
})
