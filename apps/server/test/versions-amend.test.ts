import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

const DT = 'Va Invoice'
const ROW = 'Va Line'

// Each test creates the DocTypes inside its own rolled-back transaction —
// the naming series increments roll back with it.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: ROW,
    istable: true,
    fields: [{ fieldname: 'item', fieldtype: 'Data' }],
  })
  await admin.post('/api/doctype', {
    name: DT,
    is_submittable: true,
    autoname: 'VAINV-.####',
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'amount', fieldtype: 'Currency' },
      { fieldname: 'lines', fieldtype: 'Table', options: ROW },
    ],
  })
}

describe('DOC-009: version history', () => {
  test('each update records a Version whose diff lists exactly the changed fields', async ({
    admin,
  }) => {
    await setup(admin)
    const doc = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: DT,
      doc: { title: 'v1', amount: 10 },
    })

    await admin.post('/api/save_doc', {
      doctype: DT,
      doc: { name: doc.name, modified: doc.modified, title: 'v2', amount: 25 },
    })
    const versions = await sql`
      select data from tab_version where ref_doctype = ${DT} and ref_name = ${String(doc.name)}
      order by creation`
    expect(versions).toHaveLength(1)
    const changed = (versions[0].data as { changed: [string, unknown, unknown][] }).changed
    const byField = Object.fromEntries(changed.map(([f, o, n]) => [f, [o, n]]))
    expect(Object.keys(byField).sort()).toEqual(['amount', 'title'])
    expect(byField.title).toEqual(['v1', 'v2'])
    expect(Number(byField.amount[0])).toBe(10)
    expect(Number(byField.amount[1])).toBe(25)

    // second save -> second version
    const fresh = await admin.get<Record<string, unknown>>(
      `/api/doc/${encodeURIComponent(DT)}/${doc.name}`,
    )
    await admin.post('/api/save_doc', {
      doctype: DT,
      doc: { name: doc.name, modified: fresh.modified, title: 'v3' },
    })
    const after = await sql`
      select 1 from tab_version where ref_doctype = ${DT} and ref_name = ${String(doc.name)}`
    expect(after).toHaveLength(2)
  })

  test('a no-op save records no version', async ({ admin }) => {
    await setup(admin)
    const doc = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: DT,
      doc: { title: 'same' },
    })
    await admin.post('/api/save_doc', {
      doctype: DT,
      doc: { name: doc.name, modified: doc.modified, title: 'same' },
    })
    const versions = await sql`
      select 1 from tab_version where ref_name = ${String(doc.name)}`
    expect(versions).toHaveLength(0)
  })
})

describe('DOC-008: amend cancelled documents', () => {
  test('amend copies fields+children with amended_from and NAME-n naming', async ({ admin }) => {
    await setup(admin)
    const doc = await admin.post<Record<string, any>>('/api/save_doc', {
      doctype: DT,
      doc: { title: 'to amend', amount: 99, lines: [{ item: 'x' }, { item: 'y' }] },
    })

    // must be cancelled first
    await expect(
      admin.post('/api/amend_doc', { doctype: DT, name: doc.name }),
    ).rejects.toMatchObject({ status: 417 })
    await admin.post('/api/submit_doc', { doctype: DT, name: doc.name })
    await expect(
      admin.post('/api/amend_doc', { doctype: DT, name: doc.name }),
    ).rejects.toMatchObject({ status: 417 })
    await admin.post('/api/cancel_doc', { doctype: DT, name: doc.name })

    const amended = await admin.post<Record<string, any>>('/api/amend_doc', {
      doctype: DT,
      name: doc.name,
    })
    expect(amended.name).toBe(`${doc.name}-1`)
    expect(amended.amended_from).toBe(doc.name)
    expect(amended.docstatus).toBe(0)
    expect(amended.title).toBe('to amend')
    expect(amended.lines.map((r: any) => r.item)).toEqual(['x', 'y'])
    expect(amended.lines[0].name).not.toBe(doc.lines[0].name)

    // amended doc is editable and resubmittable
    const edit = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: DT,
        doc: { name: amended.name, modified: amended.modified, amount: 120 },
      }),
    })
    expect(edit.status).toBe(201)
    const resubmit = await admin.fetch('/api/submit_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, name: amended.name }),
    })
    expect(resubmit.status).toBe(200)

    // amending the same cancelled doc again derives NAME-2
    const second = await admin.post<Record<string, unknown>>('/api/amend_doc', {
      doctype: DT,
      name: doc.name,
    })
    expect(second.name).toBe(`${doc.name}-2`)
  })
})
