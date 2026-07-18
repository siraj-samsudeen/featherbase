import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Flag Test Asset'

function save(admin: TestClient, doc: Record<string, unknown>) {
  return admin.fetch('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: DT, doc }),
  })
}

async function makeDT(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data', reqd: true },
      { fieldname: 'code', fieldtype: 'Data', unique: true },
      { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed', default_value: 'Open' },
      { fieldname: 'grade', fieldtype: 'Data', read_only: true, default_value: 'system' },
      { fieldname: 'count_val', fieldtype: 'Int' },
    ],
  })
}

describe('META-010: field flags', () => {
  test('applies defaults on insert (including read_only defaults)', async ({ admin }) => {
    await makeDT(admin)
    const doc = (await (await save(admin, { title: 'a' })).json()) as Record<string, unknown>
    expect(doc.status).toBe('Open')
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
      await save(admin, { name: doc.name, modified: doc.modified, grade: 'hacked again', title: 'b2' })
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
      await save(admin, { title: 'd', status: 'Closed' })
    ).json()) as Record<string, unknown>
    expect(doc.status).toBe('Closed')
  })

  test('evaluator regression: out-of-range Int returns 417, not 500', async ({ admin }) => {
    await makeDT(admin)
    const res = await save(admin, { title: 'e', count_val: 99999999999999999999 })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.fields.count_val).toMatch(/out of range/)
  })
})
