import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Sync Task'
const TABLE = 'sync_task'

async function columns(): Promise<string[]> {
  const rows = await sql`
    select column_name from information_schema.columns where table_name = ${TABLE}`
  return rows.map((r) => r.column_name as string)
}

const baseColumns = [
  { column_name: 'title', column_type: 'Data', label: 'Title' },
  { column_name: 'points', column_type: 'Int' },
]

// The legacy suite mutated ONE Table across sequential tests; under the
// sandbox each test rebuilds the state it needs, then rolls back.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', { name: DT, columns: baseColumns })
  for (const t of ['a', 'b'])
    await admin.post('/api/save_row', { table: DT, row: { title: t, points: 1 } })
}

async function addSeverity(admin: TestClient) {
  return admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, {
    method: 'PUT',
    body: JSON.stringify({
      columns: [...baseColumns, { column_name: 'severity', column_type: 'Choice', choices: 'Low\nHigh' }],
    }),
  })
}

describe('META-004: schema sync', () => {
  test('adding a field creates the column; existing data untouched', async ({ admin }) => {
    await setup(admin)
    const res = await addSeverity(admin)
    expect(res.status).toBe(200)
    expect(await columns()).toContain('severity')
    const rows = await sql.unsafe(`select title, points from ${TABLE} order by title`)
    expect(rows.map((r) => [r.title, Number(r.points)])).toEqual([['a', 1], ['b', 1]])
    // new field usable immediately
    const save = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: DT, row: { title: 'c', severity: 'High' } }),
    })
    expect(save.status).toBe(201)
  })

  test('property edits (label, reqd) apply without touching the table', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        columns: [
          { column_name: 'title', column_type: 'Data', label: 'Headline', reqd: true },
          { column_name: 'points', column_type: 'Int' },
          { column_name: 'severity', column_type: 'Choice', choices: 'Low\nHigh' },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const meta = await admin.get<{
      columns: { column_name: string; label: string; reqd: boolean }[]
    }>(`/api/table/${encodeURIComponent(DT)}:meta`)
    const title = meta.columns.find((f) => f.column_name === 'title')!
    expect(title.label).toBe('Headline')
    expect(title.reqd).toBe(true)
    // reqd now enforced
    const bad = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: DT, row: { points: 5 } }),
    })
    expect(bad.status).toBe(417)
  })

  test('removing a column drops the column_def but NEVER the physical column without the flag', async ({
    admin,
  }) => {
    await setup(admin)
    const res = await admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        columns: [
          { column_name: 'title', column_type: 'Data', label: 'Headline', reqd: true },
          { column_name: 'severity', column_type: 'Choice', choices: 'Low\nHigh' },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const meta = await admin.get<{ columns: { column_name: string }[] }>(
      `/api/table/${encodeURIComponent(DT)}:meta`,
    )
    expect(meta.columns.map((f) => f.column_name)).not.toContain('points')
    expect(await columns()).toContain('points') // data retained
    const rows = await sql.unsafe(`select points from ${TABLE} where title='a'`)
    expect(Number(rows[0].points)).toBe(1)
  })

  test('drop_columns flag really drops; column_type changes are rejected', async ({ admin }) => {
    await setup(admin)
    expect((await addSeverity(admin)).status).toBe(200)
    const drop = await admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        drop_columns: true,
        columns: [{ column_name: 'title', column_type: 'Data', label: 'Headline', reqd: true }],
      }),
    })
    expect(drop.status).toBe(200)
    expect(await columns()).not.toContain('severity')

    const badType = await admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        columns: [{ column_name: 'title', column_type: 'Int' }],
      }),
    })
    expect(badType.status).toBe(417)
    expect((await badType.json()).error.fields.title).toMatch(/column_type cannot change/)
  })
})
