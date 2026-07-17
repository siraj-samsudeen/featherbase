import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { getMeta, invalidateMeta } from '../src/meta'
import { areq } from './helpers'

// CUST-002: Property Setters override field/DocType properties without
// touching the base definition.

const DT = 'Ps Target'

async function cleanup() {
  await sql`delete from tab_property_setter where doc_type = ${DT}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_ps_target')
  invalidateMeta(DT)
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Title' }],
    }),
  })
})

afterAll(cleanup)

describe('CUST-002: property setters', () => {
  it('overrides a field label in effective meta but leaves the base row unchanged', async () => {
    const res = await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Property Setter',
        doc: {
          name: `${DT}-title-label`,
          doc_type: DT,
          field_name: 'title',
          property: 'label',
          value: 'Headline',
        },
      }),
    })
    expect(res.status).toBe(201)

    const meta = await getMeta(DT)
    expect(meta.fields.find((f) => f.fieldname === 'title')?.label).toBe('Headline')

    // Base docfield row untouched.
    const [row] = await sql`select label from tab_docfield where parent = ${DT} and fieldname = 'title'`
    expect(row.label).toBe('Title')
  })

  it('coerces boolean properties (hidden/reqd)', async () => {
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Property Setter',
        doc: {
          name: `${DT}-title-reqd`,
          doc_type: DT,
          field_name: 'title',
          property: 'reqd',
          value: '1',
        },
      }),
    })
    const meta = await getMeta(DT)
    const f = meta.fields.find((x) => x.fieldname === 'title')!
    expect(f.reqd).toBe(true)
    // Base row still false.
    const [row] = await sql`select reqd from tab_docfield where parent = ${DT} and fieldname = 'title'`
    expect(row.reqd).toBe(false)
  })

  it('removing the setter restores the original property', async () => {
    await areq(`/api/resource/Property%20Setter/${encodeURIComponent(`${DT}-title-label`)}`, {
      method: 'DELETE',
    })
    const meta = await getMeta(DT)
    expect(meta.fields.find((f) => f.fieldname === 'title')?.label).toBe('Title')
  })
})
