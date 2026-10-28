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

describe('A column can be marked unique', () => {
  // SPEC: A column can be marked unique (#510) — turning unique on over
  // repeated values is refused naming the column and the value, and the
  // Table is left as it was.
  test('making a column unique while its rows repeat a value is refused, naming the column', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Flag Late Unique', columns: [{ column_name: 'code', column_type: 'Data' }] })
    for (let i = 0; i < 2; i++)
      await admin.post('/api/save_row', { table: 'Flag Late Unique', row: { code: 'A' } })
    const res = await admin.fetch(`/api/table_def/${encodeURIComponent('Flag Late Unique')}`, {
      method: 'PUT',
      body: JSON.stringify({ columns: [{ column_name: 'code', column_type: 'Data', unique: true }] }),
    })
    expect(res.status).toBe(417)
    expect((await res.json()).error.fields.code).toMatch(/"A" is held by 2 rows/)
    const meta = await admin.get<{ columns: { column_name: string; unique: boolean }[] }>(
      `/api/table/${encodeURIComponent('Flag Late Unique')}:meta`,
    )
    expect(meta.columns.find((c) => c.column_name === 'code')?.unique).toBe(false)
    // The refusal adds no constraint behind the definition's back.
    await admin.post('/api/save_row', { table: 'Flag Late Unique', row: { code: 'A' } })
  })

  test('a column whose filled-in values are distinct becomes unique, however many rows leave it empty', async ({ admin }) => {
    const T = 'Flag Distinct Unique'
    await admin.post('/api/table_def', { name: T, columns: [{ column_name: 'code', column_type: 'Data' }] })
    for (const code of ['A', 'B', null, null]) await admin.post('/api/save_row', { table: T, row: { code } })
    await admin.put(`/api/table_def/${encodeURIComponent(T)}`, { columns: [{ column_name: 'code', column_type: 'Data', unique: true }] })
    await expect(admin.post('/api/save_row', { table: T, row: { code: 'A' } })).rejects.toMatchObject({ status: 417 })
  })

  test('putting a removed column back as unique over its kept repeats is refused the same way', async ({ admin }) => {
    const T = 'Flag Back Unique'
    await admin.post('/api/table_def', { name: T, columns: [{ column_name: 'title', column_type: 'Data' }, { column_name: 'code', column_type: 'Data' }] })
    for (let i = 0; i < 2; i++) await admin.post('/api/save_row', { table: T, row: { title: `t${i}`, code: 'B' } })
    await admin.put(`/api/table_def/${encodeURIComponent(T)}`, { columns: [{ column_name: 'title', column_type: 'Data' }], remove_columns: ['code'] })
    const res = await admin.fetch(`/api/table_def/${encodeURIComponent(T)}`, {
      method: 'PUT',
      body: JSON.stringify({ columns: [{ column_name: 'title', column_type: 'Data' }, { column_name: 'code', column_type: 'Data', unique: true }] }),
    })
    expect(res.status).toBe(417)
    expect((await res.json()).error.fields.code).toMatch(/"B" is held by 2 rows/)
    const meta = await admin.get<{ columns: { column_name: string }[] }>(`/api/table/${encodeURIComponent(T)}:meta`)
    expect(meta.columns.map((c) => c.column_name)).toEqual(['title'])
  })

  test('a unique column taken out stops refusing repeats, and comes back unique only over distinct values', async ({ admin }) => {
    const T = 'Flag Removed Unique'
    const title = { column_name: 'title', column_type: 'Data' }
    const put = (body: object) => admin.fetch(`/api/table_def/${encodeURIComponent(T)}`, { method: 'PUT', body: JSON.stringify(body) })
    await admin.post('/api/table_def', { name: T, columns: [title, { column_name: 'code', column_type: 'Data', unique: true }] })
    await admin.post('/api/save_row', { table: T, row: { title: 't0', code: 'C' } })
    expect((await put({ columns: [title], remove_columns: ['code'] })).status).toBe(200)
    // Put back without unique: the old rule must not linger out of sight.
    expect((await put({ columns: [title, { column_name: 'code', column_type: 'Data' }] })).status).toBe(200)
    expect((await admin.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: T, row: { title: 't1', code: 'C' } }) })).status).toBe(201)
    // Removed again and put back unique: the repeat is named, not a bare 500.
    expect((await put({ columns: [title], remove_columns: ['code'] })).status).toBe(200)
    const res = await put({ columns: [title, { column_name: 'code', column_type: 'Data', unique: true }] })
    expect(res.status).toBe(417)
    expect((await res.json()).error.fields.code).toMatch(/"C" is held by 2 rows/)
  })

  test('a long repeated value is shortened in the refusal', async ({ admin }) => {
    const T = 'Flag Long Unique'
    const long = 'x'.repeat(130)
    await admin.post('/api/table_def', { name: T, columns: [{ column_name: 'code', column_type: 'Data' }] })
    for (let i = 0; i < 2; i++) await admin.post('/api/save_row', { table: T, row: { code: long } })
    const res = await admin.fetch(`/api/table_def/${encodeURIComponent(T)}`, {
      method: 'PUT',
      body: JSON.stringify({ columns: [{ column_name: 'code', column_type: 'Data', unique: true }] }),
    })
    const message = (await res.json()).error.fields.code as string
    expect(message).toMatch(/^"x{60}…" is held by 2 rows/)
  })
})
