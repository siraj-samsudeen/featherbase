import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { getDoc, saveDoc } from '../src/document'

const DT = 'Upd Test Note'
const TABLE = 'upd_test_note'

async function makeDT(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
}

describe('DOC-002 + META-005: update with conflict detection, standard columns auto-set', () => {
  test('updates with a fresh updated_at value and bumps updated_at/updated_by', async ({ admin }) => {
    await makeDT(admin)
    const created = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: DT,
      row: { title: 'v1' },
    })

    const updated = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: DT,
      row: { row_id: created.row_id, updated_at: created.updated_at, title: 'v2' },
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
    const created = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: DT,
      row: { title: 'a' },
    })

    // First save wins
    await admin.post('/api/save_row', {
      table: DT,
      row: { row_id: created.row_id, updated_at: created.updated_at, title: 'b' },
    })

    // Second save with the ORIGINAL (now stale) timestamp loses
    await expect(
      admin.post('/api/save_row', {
        table: DT,
        row: { row_id: created.row_id, updated_at: created.updated_at, title: 'c' },
      }),
    ).rejects.toMatchObject({ status: 409, type: 'ConflictError' })
    const [row] = await sql.unsafe(
      `select title from ${TABLE} where row_id = '${created.row_id}'`,
    )
    expect(row.title).toBe('b')
  })

  test('rejects an update without an updated_at timestamp', async ({ admin }) => {
    await makeDT(admin)
    const created = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: DT,
      row: { title: 'x' },
    })
    await expect(
      admin.post('/api/save_row', {
        table: DT,
        row: { row_id: created.row_id, title: 'y' },
      }),
    ).rejects.toMatchObject({ status: 417 })
  })

  // A server-side caller echoes back the value it loaded, and off the driver
  // that value is a Date. String(Date) truncates to whole seconds, so a row
  // whose stamp carries milliseconds used to conflict with itself (#131 in
  // service-accounts.ts, then again on the SSO path). The check accepts the
  // shape it hands out, whatever the Table.
  test('accepts the raw Date a loaded row carries as the echo', async ({ admin }) => {
    await makeDT(admin)
    const created = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: DT,
      row: { title: 'v1' },
    })
    // now() usually carries milliseconds; pin one so this cannot pass by luck.
    await sql.unsafe(
      `update ${TABLE} set updated_at = '2026-08-06T10:20:30.123Z' where row_id = '${created.row_id}'`,
    )

    const loaded = await getDoc(DT, String(created.row_id))
    expect(loaded.updated_at).toBeInstanceOf(Date)
    const saved = await saveDoc(
      DT,
      { row_id: created.row_id, updated_at: loaded.updated_at, title: 'v2' },
      'Administrator',
    )
    expect(saved.title).toBe('v2')
  })

  test('404s when updating a nonexistent name', async ({ admin }) => {
    await makeDT(admin)
    await expect(
      admin.post('/api/save_row', {
        table: DT,
        row: { row_id: 'ghost', updated_at: new Date().toISOString(), title: 'z' },
      }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
