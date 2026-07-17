import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import type { TestClient } from 'feather-testing-postgres'

// CUST-002: Property Setters override field/DocType properties without
// touching the base definition.

const DT = 'Ps Target'

async function makeDT(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Title' }],
  })
}

async function addLabelSetter(admin: TestClient) {
  return admin.fetch('/api/save_doc', {
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
}

describe('CUST-002: property setters', () => {
  test('overrides a field label in effective meta but leaves the base row unchanged', async ({
    admin,
  }) => {
    await makeDT(admin)
    const res = await addLabelSetter(admin)
    expect(res.status).toBe(201)

    const meta = await getMeta(DT)
    expect(meta.fields.find((f) => f.fieldname === 'title')?.label).toBe('Headline')

    // Base docfield row untouched.
    const [row] = await sql`select label from tab_docfield where parent = ${DT} and fieldname = 'title'`
    expect(row.label).toBe('Title')
  })

  test('coerces boolean properties (hidden/reqd)', async ({ admin }) => {
    await makeDT(admin)
    await admin.post('/api/save_doc', {
      doctype: 'Property Setter',
      doc: {
        name: `${DT}-title-reqd`,
        doc_type: DT,
        field_name: 'title',
        property: 'reqd',
        value: '1',
      },
    })
    const meta = await getMeta(DT)
    const f = meta.fields.find((x) => x.fieldname === 'title')!
    expect(f.reqd).toBe(true)
    // Base row still false.
    const [row] = await sql`select reqd from tab_docfield where parent = ${DT} and fieldname = 'title'`
    expect(row.reqd).toBe(false)
  })

  test('removing the setter restores the original property', async ({ admin }) => {
    await makeDT(admin)
    await addLabelSetter(admin)
    await admin.delete(
      `/api/resource/Property%20Setter/${encodeURIComponent(`${DT}-title-label`)}`,
    )
    const meta = await getMeta(DT)
    expect(meta.fields.find((f) => f.fieldname === 'title')?.label).toBe('Title')
  })
})
