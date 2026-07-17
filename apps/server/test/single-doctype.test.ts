import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { getDoc, saveDoc } from '../src/document'
import { getList } from '../src/query'
import { createDocType } from '../src/doctype-engine'

// SET-001: Single DocTypes store one instance in the EAV store, apply
// defaults, and never create a table.

const DT = 'Set Srv Single'

async function cleanup() {
  await sql`delete from single_value where doctype = ${DT}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
}

beforeAll(async () => {
  await cleanup()
  await createDocType({
    name: DT,
    issingle: true,
    fields: [
      { fieldname: 'title', fieldtype: 'Data', default_value: 'Default Title' },
      { fieldname: 'count', fieldtype: 'Int', default_value: '5' },
      { fieldname: 'active', fieldtype: 'Check', default_value: '0' },
    ],
  })
})

afterAll(cleanup)

describe('SET-001: single doctypes', () => {
  it('creates no table for a single', async () => {
    const [t] = await sql`select to_regclass('tab_set_srv_single') as t`
    expect(t.t).toBeNull()
  })

  it('reads defaults before anything is saved', async () => {
    const doc = await getDoc(DT, DT, 'Administrator')
    expect(doc.name).toBe(DT)
    expect(doc.title).toBe('Default Title')
    expect(doc.count).toBe(5)
    expect(doc.active).toBe(false)
  })

  it('persists saved values (typed round-trip) with exactly one instance', async () => {
    await saveDoc(DT, { title: 'Configured', count: 42, active: true }, 'Administrator')
    const doc = await getDoc(DT, DT, 'Administrator')
    expect(doc.title).toBe('Configured')
    expect(doc.count).toBe(42)
    expect(doc.active).toBe(true)

    // Saving again updates in place — no second record.
    await saveDoc(DT, { title: 'Reconfigured' }, 'Administrator')
    const doc2 = await getDoc(DT, DT, 'Administrator')
    expect(doc2.title).toBe('Reconfigured')
    expect(doc2.count).toBe(42) // untouched field retained

    const [{ n }] = await sql`select count(distinct doctype)::int as n from single_value where doctype = ${DT}`
    expect(n).toBe(1)
  })

  it('rejects listing a single with a clean validation error (never a 500)', async () => {
    await expect(getList(DT, {}, 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError',
    })
  })
})
