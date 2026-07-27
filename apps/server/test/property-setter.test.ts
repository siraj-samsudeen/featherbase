import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import type { TestClient } from 'feather-testing-postgres'

// CUST-002: Metadata Overrides override column/Table properties without
// touching the base definition.

const DT = 'Ps Target'

async function makeDT(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
  })
}

async function addLabelSetter(admin: TestClient) {
  return admin.fetch('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'Metadata Override',
      doc: {
        name: `${DT}-title-label`,
        table_name: DT,
        column_name: 'title',
        property: 'label',
        value: 'Headline',
      },
    }),
  })
}

describe('CUST-002: metadata overrides', () => {
  test('overrides a column label in effective meta but leaves the base row unchanged', async ({
    admin,
  }) => {
    await makeDT(admin)
    const res = await addLabelSetter(admin)
    expect(res.status).toBe(201)

    const meta = await getMeta(DT)
    expect(meta.columns.find((f) => f.column_name === 'title')?.label).toBe('Headline')

    // Base column_def row untouched.
    const [row] = await sql`select label from column_def where parent = ${DT} and column_name = 'title'`
    expect(row.label).toBe('Title')
  })

  test('coerces boolean properties (hidden/reqd)', async ({ admin }) => {
    await makeDT(admin)
    await admin.post('/api/save_doc', {
      doctype: 'Metadata Override',
      doc: {
        name: `${DT}-title-reqd`,
        table_name: DT,
        column_name: 'title',
        property: 'reqd',
        value: '1',
      },
    })
    const meta = await getMeta(DT)
    const f = meta.columns.find((x) => x.column_name === 'title')!
    expect(f.reqd).toBe(true)
    // Base row still false.
    const [row] = await sql`select reqd from column_def where parent = ${DT} and column_name = 'title'`
    expect(row.reqd).toBe(false)
  })

  test('removing the setter restores the original property', async ({ admin }) => {
    await makeDT(admin)
    await addLabelSetter(admin)
    await admin.delete(
      `/api/table/Metadata%20Override/${encodeURIComponent(`${DT}-title-label`)}`,
    )
    const meta = await getMeta(DT)
    expect(meta.columns.find((f) => f.column_name === 'title')?.label).toBe('Title')
  })
})
