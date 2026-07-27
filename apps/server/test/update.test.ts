import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

const DT = 'Upd Test Note'
const TABLE = 'upd_test_note'

async function makeDT(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
}

describe('DOC-002 + META-005: update with conflict detection, standard columns auto-set', () => {
  test('updates with a fresh updated_at value and bumps updated_at/updated_by', async ({ admin }) => {
    await makeDT(admin)
    const created = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: DT,
      doc: { title: 'v1' },
    })

    const updated = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: DT,
      doc: { name: created.name, updated_at: created.updated_at, title: 'v2' },
    })
    expect(updated.title).toBe('v2')
    expect(new Date(String(updated.updated_at)).getTime()).toBeGreaterThan(
      new Date(String(created.updated_at)).getTime(),
    )
    expect(updated.created_by).toBe('Administrator')
    expect(updated.created_at).toEqual(created.created_at)
  })

  test('rejects a stale updated_at value with 409', async ({ admin }) => {
    await makeDT(admin)
    const created = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: DT,
      doc: { title: 'a' },
    })

    // First save wins
    await admin.post('/api/save_doc', {
      doctype: DT,
      doc: { name: created.name, updated_at: created.updated_at, title: 'b' },
    })

    // Second save with the ORIGINAL (now stale) timestamp loses
    await expect(
      admin.post('/api/save_doc', {
        doctype: DT,
        doc: { name: created.name, updated_at: created.updated_at, title: 'c' },
      }),
    ).rejects.toMatchObject({ status: 409, type: 'ConflictError' })
    const [row] = await sql.unsafe(
      `select title from ${TABLE} where name = '${created.name}'`,
    )
    expect(row.title).toBe('b')
  })

  test('rejects an update without an updated_at timestamp', async ({ admin }) => {
    await makeDT(admin)
    const created = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: DT,
      doc: { title: 'x' },
    })
    await expect(
      admin.post('/api/save_doc', {
        doctype: DT,
        doc: { name: created.name, title: 'y' },
      }),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('404s when updating a nonexistent name', async ({ admin }) => {
    await makeDT(admin)
    await expect(
      admin.post('/api/save_doc', {
        doctype: DT,
        doc: { name: 'ghost', updated_at: new Date().toISOString(), title: 'z' },
      }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
