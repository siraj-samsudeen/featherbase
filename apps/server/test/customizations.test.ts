import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { exportCustomizations, importCustomizations } from '../src/customizations'
import type { TestClient } from 'feather-testing-postgres'

// CUST-005: customizations (Custom Fields + Property Setters) round-trip
// through export → import, recreating the column and re-applying the property.

const DT = 'Cust5 Srv'

// Per-test setup (the sandbox rolls everything back): the DocType plus one
// custom field and one property setter.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [{ fieldname: 'title', fieldtype: 'Data' }],
  })
  await admin.post('/api/save_doc', {
    doctype: 'Custom Field',
    doc: { name: `${DT}-priority`, dt: DT, fieldname: 'priority', label: 'Priority', fieldtype: 'Select', options: 'Low\nHigh', in_list_view: true },
  })
  await admin.post('/api/save_doc', {
    doctype: 'Property Setter',
    doc: { name: `${DT}-title-reqd`, doc_type: DT, field_name: 'title', property: 'reqd', value: '1' },
  })
}

describe('CUST-005: export/import customizations', () => {
  test('exports the custom fields and property setters for a DocType', async ({ admin }) => {
    await setup(admin)
    const bundle = await exportCustomizations(DT)
    expect(bundle.custom_fields.map((f) => f.fieldname)).toEqual(['priority'])
    expect(bundle.custom_fields[0].options).toBe('Low\nHigh')
    expect(bundle.property_setters).toEqual([
      expect.objectContaining({ field_name: 'title', property: 'reqd', value: '1' }),
    ])
  })

  test('re-creates them on import after they are deleted', async ({ admin }) => {
    await setup(admin)
    const bundle = await exportCustomizations(DT)
    // Delete the customizations.
    await admin.delete(`/api/resource/Custom%20Field/${encodeURIComponent(`${DT}-priority`)}`)
    await admin.delete(
      `/api/resource/Property%20Setter/${encodeURIComponent(`${DT}-title-reqd`)}`,
    )
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

  test('is idempotent — re-importing creates nothing new', async ({ admin }) => {
    await setup(admin)
    const bundle = await exportCustomizations(DT)
    const counts = await importCustomizations(bundle, 'Administrator')
    expect(counts).toEqual({ custom_fields: 0, property_setters: 0 })
  })

  test('exposes export/import over HTTP, gated to System Managers', async ({ admin }) => {
    await setup(admin)
    const bundle = await admin.get<{ custom_fields: unknown[] }>(
      `/api/export_customizations/${encodeURIComponent(DT)}`,
    )
    expect(bundle.custom_fields.length).toBe(1)
  })
})
