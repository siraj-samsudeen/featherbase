import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Flag Test Asset'

function save(admin: TestClient, row: Record<string, unknown>) {
  return admin.fetch('/api/save_row', {
    method: 'POST',
    body: JSON.stringify({ table: DT, row }),
  })
}

// The Table's own two-value field is named `stage` (not `status`) — `status`
// is now the reserved draft/submitted/cancelled lifecycle column and a
// custom column may not shadow it.
async function makeDT(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data', reqd: true },
      { column_name: 'code', column_type: 'Data', unique: true },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed', default_value: 'Open' },
      { column_name: 'grade', column_type: 'Data', read_only: true, default_value: 'system' },
      { column_name: 'count_val', column_type: 'Int' },
    ],
  })
}

describe('META-010: field flags', () => {
  test('applies defaults on insert (including read_only defaults)', async ({ admin }) => {
    await makeDT(admin)
    const doc = (await (await save(admin, { title: 'a' })).json()) as Record<string, unknown>
    expect(doc.stage).toBe('Open')
    expect(doc.grade).toBe('system')
  })

  test('ignores client-sent values for read_only fields on insert and update', async ({
    admin,
  }) => {
    await makeDT(admin)
    const doc = (await (
      await save(admin, { title: 'b', grade: 'hacked' })
    ).json()) as Record<string, unknown>
    expect(doc.grade).toBe('system')

    const upd = (await (
      await save(admin, { row_id: doc.row_id, updated_at: doc.updated_at, grade: 'hacked again', title: 'b2' })
    ).json()) as Record<string, unknown>
    expect(upd.title).toBe('b2')
    expect(upd.grade).toBe('system')
  })

  test('maps unique violations to field-wise 417s, not 500s', async ({ admin }) => {
    await makeDT(admin)
    expect((await save(admin, { title: 'c1', code: 'DUP' })).status).toBe(201)
    const res = await save(admin, { title: 'c2', code: 'DUP' })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.fields.code).toMatch(/unique/)
  })

  test('missing reqd still fails; explicit default override works', async ({ admin }) => {
    await makeDT(admin)
    expect((await save(admin, { code: 'x' })).status).toBe(417)
    const doc = (await (
      await save(admin, { title: 'd', stage: 'Closed' })
    ).json()) as Record<string, unknown>
    expect(doc.stage).toBe('Closed')
  })

  test('evaluator regression: out-of-range Int returns 417, not 500', async ({ admin }) => {
    await makeDT(admin)
    const res = await save(admin, { title: 'e', count_val: 99999999999999999999 })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.fields.count_val).toMatch(/out of range/)
  })
})
