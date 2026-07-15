import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'

const DT = 'Va Invoice'
const ROW = 'Va Line'

async function post(path: string, body: unknown) {
  return areq(path, { method: 'POST', body: JSON.stringify(body) })
}

async function cleanup() {
  await sql`delete from tab_version where ref_doctype = ${DT}`
  await sql`delete from tab_doctype where name in (${DT}, ${ROW})`
  await sql.unsafe('drop table if exists tab_va_invoice')
  await sql.unsafe('drop table if exists tab_va_line')
}

beforeAll(async () => {
  await cleanup()
  await post('/api/doctype', {
    name: ROW,
    istable: true,
    fields: [{ fieldname: 'item', fieldtype: 'Data' }],
  })
  await post('/api/doctype', {
    name: DT,
    is_submittable: true,
    autoname: 'VAINV-.####',
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'amount', fieldtype: 'Currency' },
      { fieldname: 'lines', fieldtype: 'Table', options: ROW },
    ],
  })
})

afterAll(async () => {
  await cleanup()
  await sql`delete from series where name = 'VAINV-'`
  await sql.end()
})

describe('DOC-009: version history', () => {
  it('each update records a Version whose diff lists exactly the changed fields', async () => {
    const doc = (await (
      await post('/api/save_doc', { doctype: DT, doc: { title: 'v1', amount: 10 } })
    ).json()) as Record<string, unknown>

    await post('/api/save_doc', {
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
    const fresh = (await (
      await areq(`/api/doc/${encodeURIComponent(DT)}/${doc.name}`)
    ).json()) as Record<string, unknown>
    await post('/api/save_doc', {
      doctype: DT,
      doc: { name: doc.name, modified: fresh.modified, title: 'v3' },
    })
    const after = await sql`
      select 1 from tab_version where ref_doctype = ${DT} and ref_name = ${String(doc.name)}`
    expect(after).toHaveLength(2)
  })

  it('a no-op save records no version', async () => {
    const doc = (await (
      await post('/api/save_doc', { doctype: DT, doc: { title: 'same' } })
    ).json()) as Record<string, unknown>
    await post('/api/save_doc', {
      doctype: DT,
      doc: { name: doc.name, modified: doc.modified, title: 'same' },
    })
    const versions = await sql`
      select 1 from tab_version where ref_name = ${String(doc.name)}`
    expect(versions).toHaveLength(0)
  })
})

describe('DOC-008: amend cancelled documents', () => {
  it('amend copies fields+children with amended_from and NAME-n naming', async () => {
    const doc = (await (
      await post('/api/save_doc', {
        doctype: DT,
        doc: { title: 'to amend', amount: 99, lines: [{ item: 'x' }, { item: 'y' }] },
      })
    ).json()) as Record<string, any>

    // must be cancelled first
    expect((await post('/api/amend_doc', { doctype: DT, name: doc.name })).status).toBe(417)
    await post('/api/submit_doc', { doctype: DT, name: doc.name })
    expect((await post('/api/amend_doc', { doctype: DT, name: doc.name })).status).toBe(417)
    await post('/api/cancel_doc', { doctype: DT, name: doc.name })

    const amended = (await (
      await post('/api/amend_doc', { doctype: DT, name: doc.name })
    ).json()) as Record<string, any>
    expect(amended.name).toBe(`${doc.name}-1`)
    expect(amended.amended_from).toBe(doc.name)
    expect(amended.docstatus).toBe(0)
    expect(amended.title).toBe('to amend')
    expect(amended.lines.map((r: any) => r.item)).toEqual(['x', 'y'])
    expect(amended.lines[0].name).not.toBe(doc.lines[0].name)

    // amended doc is editable and resubmittable
    const edit = await post('/api/save_doc', {
      doctype: DT,
      doc: { name: amended.name, modified: amended.modified, amount: 120 },
    })
    expect(edit.status).toBe(201)
    expect((await post('/api/submit_doc', { doctype: DT, name: amended.name })).status).toBe(200)

    // amending the same cancelled doc again derives NAME-2
    const second = (await (
      await post('/api/amend_doc', { doctype: DT, name: doc.name })
    ).json()) as Record<string, unknown>
    expect(second.name).toBe(`${doc.name}-2`)
  })
})
