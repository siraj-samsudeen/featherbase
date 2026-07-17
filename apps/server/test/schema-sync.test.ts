import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Sync Task'
const TABLE = 'tab_sync_task'

async function columns(): Promise<string[]> {
  const rows = await sql`
    select column_name from information_schema.columns where table_name = ${TABLE}`
  return rows.map((r) => r.column_name as string)
}

const baseFields = [
  { fieldname: 'title', fieldtype: 'Data', label: 'Title' },
  { fieldname: 'points', fieldtype: 'Int' },
]

// The legacy suite mutated ONE DocType across sequential tests; under the
// sandbox each test rebuilds the state it needs, then rolls back.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', { name: DT, fields: baseFields })
  for (const t of ['a', 'b'])
    await admin.post('/api/save_doc', { doctype: DT, doc: { title: t, points: 1 } })
}

async function addSeverity(admin: TestClient) {
  return admin.fetch(`/api/doctype/${encodeURIComponent(DT)}`, {
    method: 'PUT',
    body: JSON.stringify({
      fields: [...baseFields, { fieldname: 'severity', fieldtype: 'Select', options: 'Low\nHigh' }],
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
    const save = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, doc: { title: 'c', severity: 'High' } }),
    })
    expect(save.status).toBe(201)
  })

  test('property edits (label, reqd) apply without touching the table', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch(`/api/doctype/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        fields: [
          { fieldname: 'title', fieldtype: 'Data', label: 'Headline', reqd: true },
          { fieldname: 'points', fieldtype: 'Int' },
          { fieldname: 'severity', fieldtype: 'Select', options: 'Low\nHigh' },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const meta = await admin.get<{
      fields: { fieldname: string; label: string; reqd: boolean }[]
    }>(`/api/meta/${encodeURIComponent(DT)}`)
    const title = meta.fields.find((f) => f.fieldname === 'title')!
    expect(title.label).toBe('Headline')
    expect(title.reqd).toBe(true)
    // reqd now enforced
    const bad = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, doc: { points: 5 } }),
    })
    expect(bad.status).toBe(417)
  })

  test('removing a field drops the docfield but NEVER the column without the flag', async ({
    admin,
  }) => {
    await setup(admin)
    const res = await admin.fetch(`/api/doctype/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        fields: [
          { fieldname: 'title', fieldtype: 'Data', label: 'Headline', reqd: true },
          { fieldname: 'severity', fieldtype: 'Select', options: 'Low\nHigh' },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const meta = await admin.get<{ fields: { fieldname: string }[] }>(
      `/api/meta/${encodeURIComponent(DT)}`,
    )
    expect(meta.fields.map((f) => f.fieldname)).not.toContain('points')
    expect(await columns()).toContain('points') // data retained
    const rows = await sql.unsafe(`select points from ${TABLE} where title='a'`)
    expect(Number(rows[0].points)).toBe(1)
  })

  test('drop_columns flag really drops; fieldtype changes are rejected', async ({ admin }) => {
    await setup(admin)
    expect((await addSeverity(admin)).status).toBe(200)
    const drop = await admin.fetch(`/api/doctype/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        drop_columns: true,
        fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Headline', reqd: true }],
      }),
    })
    expect(drop.status).toBe(200)
    expect(await columns()).not.toContain('severity')

    const badType = await admin.fetch(`/api/doctype/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        fields: [{ fieldname: 'title', fieldtype: 'Int' }],
      }),
    })
    expect(badType.status).toBe(417)
    expect((await badType.json()).error.fields.title).toMatch(/fieldtype cannot change/)
  })
})
