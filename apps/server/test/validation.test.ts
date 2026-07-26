import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

const DT = 'Val Test Ticket'
const TABLE = 'val_test_ticket'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data', reqd: true },
      { column_name: 'qty', column_type: 'Int' },
      { column_name: 'severity', column_type: 'Choice', choices: 'Low\nHigh' },
      { column_name: 'due', column_type: 'Date' },
    ],
  })
}

const save = (admin: TestClient, doc: Record<string, unknown>) =>
  admin.post<Record<string, unknown>>('/api/save_doc', { doctype: DT, doc })

describe('DOC-011: field-wise validation errors', () => {
  test('returns BOTH errors keyed by column_name for a doubly-invalid payload', async ({
    admin,
  }) => {
    await setup(admin)
    let caught: any
    try {
      await save(admin, { qty: 'not-a-number', due: '15-07-2026' })
    } catch (e) {
      caught = e
    }
    expect(caught).toMatchObject({ status: 417, type: 'ValidationError' })
    expect(Object.keys(caught.fields).sort()).toEqual(['due', 'qty', 'title'])
    expect(caught.fields.due).toMatch(/YYYY-MM-DD/)
  })

  test('missing required column errors by column_name; valid doc saves with coercion', async ({
    admin,
  }) => {
    await setup(admin)
    await expect(save(admin, { qty: 2 })).rejects.toMatchObject({
      fields: { title: expect.anything() },
    })
    const ok = await save(admin, { title: 'works', qty: '7', severity: 'High', due: '2026-08-01' })
    expect(ok.qty).toBe('7')
    const [row] = await sql.unsafe(`select qty from ${TABLE} where name='${ok.name}'`)
    expect(Number(row.qty)).toBe(7)
  })
})

describe('META-009: Choice validates against choices', () => {
  test('rejects a value not in choices, accepts a valid one, allows empty', async ({
    admin,
  }) => {
    await setup(admin)
    await expect(save(admin, { title: 't', severity: 'Critical' })).rejects.toMatchObject({
      status: 417,
      fields: { severity: expect.anything() },
    })
    await save(admin, { title: 't', severity: 'Low' })
    await save(admin, { title: 't' })
  })

  test('validates on the update path too, partially', async ({ admin }) => {
    await setup(admin)
    const doc = await save(admin, { title: 'u' })
    await expect(
      save(admin, { name: doc.name, updated_at: doc.updated_at, severity: 'Nope' }),
    ).rejects.toMatchObject({ status: 417 })
    const updated = await save(admin, { name: doc.name, updated_at: doc.updated_at, severity: 'High' })
    // update must not demand reqd columns it isn't changing
    expect(updated.title).toBe('u')
  })
})
