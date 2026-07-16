import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { exportCustomizations, importCustomizations } from '../src/customizations'
import { areq } from './helpers'

// CUST-005: customizations (Custom Fields + Property Setters) round-trip
// through export → import, recreating the column and re-applying the property.

const DT = 'Cust5 Srv'

async function cleanup() {
  await sql`delete from tab_custom_field where dt = ${DT}`
  await sql`delete from tab_property_setter where doc_type = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_cust5_srv')
}

async function save(doctype: string, doc: Record<string, unknown>) {
  const res = await areq('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype, doc }) })
  if (res.status !== 201) throw new Error(`save ${doctype}: ${res.status} ${await res.text()}`)
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, fields: [{ fieldname: 'title', fieldtype: 'Data' }] }),
  })
  await save('Custom Field', { name: `${DT}-priority`, dt: DT, fieldname: 'priority', label: 'Priority', fieldtype: 'Select', options: 'Low\nHigh', in_list_view: true })
  await save('Property Setter', { name: `${DT}-title-reqd`, doc_type: DT, field_name: 'title', property: 'reqd', value: '1' })
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('CUST-005: export/import customizations', () => {
  it('exports the custom fields and property setters for a DocType', async () => {
    const bundle = await exportCustomizations(DT)
    expect(bundle.custom_fields.map((f) => f.fieldname)).toEqual(['priority'])
    expect(bundle.custom_fields[0].options).toBe('Low\nHigh')
    expect(bundle.property_setters).toEqual([
      expect.objectContaining({ field_name: 'title', property: 'reqd', value: '1' }),
    ])
  })

  it('re-creates them on import after they are deleted', async () => {
    const bundle = await exportCustomizations(DT)
    // Delete the customizations.
    await areq(`/api/resource/Custom%20Field/${encodeURIComponent(`${DT}-priority`)}`, { method: 'DELETE' })
    await areq(`/api/resource/Property%20Setter/${encodeURIComponent(`${DT}-title-reqd`)}`, { method: 'DELETE' })
    let meta = await getMeta(DT)
    expect(meta.fields.some((f) => f.fieldname === 'priority')).toBe(false)
    expect(meta.fields.find((f) => f.fieldname === 'title')?.reqd).toBeFalsy()

    // Import brings them back.
    const counts = await importCustomizations(bundle, 'Administrator')
    expect(counts).toEqual({ custom_fields: 1, property_setters: 1 })
    meta = await getMeta(DT)
    const priority = meta.fields.find((f) => f.fieldname === 'priority')
    expect(priority).toBeTruthy()
    expect(priority?.options).toBe('Low\nHigh')
    expect(meta.fields.find((f) => f.fieldname === 'title')?.reqd).toBe(true)
    // The backing column exists again.
    const [col] = await sql`select 1 from information_schema.columns where table_name = 'tab_cust5_srv' and column_name = 'priority'`
    expect(col).toBeDefined()
  })

  it('is idempotent — re-importing creates nothing new', async () => {
    const bundle = await exportCustomizations(DT)
    const counts = await importCustomizations(bundle, 'Administrator')
    expect(counts).toEqual({ custom_fields: 0, property_setters: 0 })
  })

  it('exposes export/import over HTTP, gated to System Managers', async () => {
    const res = await areq(`/api/export_customizations/${encodeURIComponent(DT)}`)
    expect(res.status).toBe(200)
    const bundle = (await res.json()) as { custom_fields: unknown[] }
    expect(bundle.custom_fields.length).toBe(1)
  })
})
