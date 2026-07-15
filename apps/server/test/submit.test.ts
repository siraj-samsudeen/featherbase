import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { app } from '../src/index'
import { clearControllers, registerController } from '../src/controllers'

const DT = 'Sbm Expense'
const PLAIN = 'Sbm Plain'

async function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const fired: string[] = []

beforeAll(async () => {
  await sql`delete from tab_doctype where name in (${DT}, ${PLAIN})`
  await sql.unsafe('drop table if exists tab_sbm_expense')
  await sql.unsafe('drop table if exists tab_sbm_plain')
  await post('/api/doctype', {
    name: DT,
    is_submittable: true,
    fields: [{ fieldname: 'amount', fieldtype: 'Currency' }],
  })
  await post('/api/doctype', {
    name: PLAIN,
    fields: [{ fieldname: 'x', fieldtype: 'Data' }],
  })
  registerController({
    doctype: DT,
    hooks: {
      on_submit: () => { fired.push('on_submit') },
      on_cancel: () => { fired.push('on_cancel') },
    },
  })
})

afterAll(async () => {
  clearControllers(DT)
  await sql`delete from tab_doctype where name in (${DT}, ${PLAIN})`
  await sql.unsafe('drop table if exists tab_sbm_expense')
  await sql.unsafe('drop table if exists tab_sbm_plain')
  await sql.end()
})

describe('DOC-007: submittable documents', () => {
  it('full lifecycle: draft -> submit (hook, immutable, undeletable) -> cancel', async () => {
    const doc = (await (
      await post('/api/save_doc', { doctype: DT, doc: { amount: 100 } })
    ).json()) as Record<string, unknown>
    expect(doc.docstatus).toBe(0)

    fired.length = 0
    const submitted = (await (
      await post('/api/submit_doc', { doctype: DT, name: doc.name })
    ).json()) as Record<string, unknown>
    expect(submitted.docstatus).toBe(1)
    expect(fired).toEqual(['on_submit'])

    // Immutable while submitted
    const edit = await post('/api/save_doc', {
      doctype: DT,
      doc: { name: doc.name, modified: submitted.modified, amount: 999 },
    })
    expect(edit.status).toBe(417)
    expect((await edit.json()).error.message).toMatch(/submitted/)

    // Cannot delete while submitted
    const delRes = await app.request(
      `/api/doc/${encodeURIComponent(DT)}/${doc.name}`,
      { method: 'DELETE' },
    )
    expect(delRes.status).toBe(417)

    // Cannot double-submit
    expect((await post('/api/submit_doc', { doctype: DT, name: doc.name })).status).toBe(417)

    const cancelled = (await (
      await post('/api/cancel_doc', { doctype: DT, name: doc.name })
    ).json()) as Record<string, unknown>
    expect(cancelled.docstatus).toBe(2)
    expect(fired).toEqual(['on_submit', 'on_cancel'])

    // Cancelled is terminal for edits
    const editCancelled = await post('/api/save_doc', {
      doctype: DT,
      doc: { name: doc.name, modified: cancelled.modified, amount: 5 },
    })
    expect(editCancelled.status).toBe(417)
  })

  it('cannot cancel a draft; cannot submit a non-submittable DocType', async () => {
    const doc = (await (
      await post('/api/save_doc', { doctype: DT, doc: { amount: 1 } })
    ).json()) as Record<string, unknown>
    expect((await post('/api/cancel_doc', { doctype: DT, name: doc.name })).status).toBe(417)

    const plain = (await (
      await post('/api/save_doc', { doctype: PLAIN, doc: { x: 'a' } })
    ).json()) as Record<string, unknown>
    const res = await post('/api/submit_doc', { doctype: PLAIN, name: plain.name })
    expect(res.status).toBe(417)
    expect((await res.json()).error.message).toMatch(/not submittable/)
  })
})
