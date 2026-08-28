import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { exportCustomizations, importCustomizations } from '../src/customizations'
import type { TestClient } from 'feather-testing-postgres'

// CUST-005: customizations (Custom Fields + Metadata Overrides) round-trip
// through export → import, recreating the column and re-applying the property.

const DT = 'Cust5 Srv'

// Per-test setup (the sandbox rolls everything back): the Table plus one
// custom field and one metadata override.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  await admin.post('/api/save_row', {
    table: 'Custom Field',
    row: {
      row_id: `${DT}-priority`,
      dt: DT,
      column_name: 'priority',
      label: 'Priority',
      column_type: 'Choice',
      choices: 'Low\nHigh',
      in_list_view: true,
    },
  })
  await admin.post('/api/save_row', {
    table: 'Metadata Override',
    row: { row_id: `${DT}-title-reqd`, table_name: DT, column_name: 'title', property: 'reqd', value: '1' },
  })
}

describe('CUST-005: export/import customizations', () => {
  test('exports the custom fields and metadata overrides for a Table', async ({ admin }) => {
    await setup(admin)
    const bundle = await exportCustomizations(DT)
    expect(bundle.custom_fields.map((f) => f.column_name)).toEqual(['priority'])
    expect(bundle.custom_fields[0].choices).toBe('Low\nHigh')
    expect(bundle.property_setters).toEqual([
      expect.objectContaining({ column_name: 'title', property: 'reqd', value: '1' }),
    ])
  })

  test('re-creates them on import after they are deleted', async ({ admin }) => {
    await setup(admin)
    const bundle = await exportCustomizations(DT)
    // Delete the customizations.
    await admin.delete(`/api/table/Custom%20Field/${encodeURIComponent(`${DT}-priority`)}`)
    await admin.delete(
      `/api/table/Metadata%20Override/${encodeURIComponent(`${DT}-title-reqd`)}`,
    )
    let meta = await getMeta(DT)
    expect(meta.columns.some((f) => f.column_name === 'priority')).toBe(false)
    expect(meta.columns.find((f) => f.column_name === 'title')?.reqd).toBeFalsy()

    // Import brings them back.
    const counts = await importCustomizations(bundle, 'Administrator')
    expect(counts).toEqual({ custom_fields: 1, property_setters: 1 })
    meta = await getMeta(DT)
    const priority = meta.columns.find((f) => f.column_name === 'priority')
    expect(priority).toMatchObject({ column_name: 'priority', column_type: 'Choice', label: 'Priority' })
    expect(priority?.choices).toBe('Low\nHigh')
    expect(meta.columns.find((f) => f.column_name === 'title')?.reqd).toBe(true)
    // The backing column exists again.
    const [col] = await sql`select 1 from information_schema.columns where table_name = 'cust5_srv' and column_name = 'priority'`
    expect(col).toEqual({ '?column?': 1 })
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
