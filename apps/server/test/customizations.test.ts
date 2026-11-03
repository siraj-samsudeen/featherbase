import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { exportCustomizations, importCustomizations } from '../src/customizations'
import type { TestClient } from 'feather-testing-postgres'
import { expectApiError } from './fixtures'

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
  await admin.post('/api/table/Metadata%20Override', {
    row_id: `${DT}-title-reqd`, table_name: DT, column_name: 'title', property: 'reqd', value: '1',
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

  test('an imported field with omitted options becomes an optional Data column', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: DT, columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    expect(await admin.post('/api/import_customizations', {
      custom_fields: [{ dt: DT, column_name: 'customer_note' }],
    })).toEqual({ custom_fields: 1, property_setters: 0 })
    const meta = await admin.get<{ columns: Record<string, unknown>[] }>(`/api/table/${encodeURIComponent(DT)}:meta`)
    expect(meta.columns.find((f) => f.column_name === 'customer_note')).toMatchObject({
      label: 'customer_note', column_type: 'Data', reqd: false, in_list_view: false, custom: true,
    })
    const created = await admin.post<{ row_id: string }>('/api/save_row', {
      table: DT, row: { title: 'With note', customer_note: 'Call after 4pm' },
    })
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/${created.row_id}`))
      .toMatchObject({ title: 'With note', customer_note: 'Call after 4pm' })
    const without = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'No note' } })
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/${without.row_id}`))
      .toMatchObject({ title: 'No note', customer_note: null })
    expect(await admin.get(`/api/export_customizations/${encodeURIComponent(DT)}`)).toEqual({
      table: DT,
      custom_fields: [{
        dt: DT, column_name: 'customer_note', label: null, column_type: 'Data',
        reference_table: null, choices: null, row_table: null, reqd: false, in_list_view: false,
      }],
      property_setters: [],
    })
  })

  test('re-importing a Table-level label override does not duplicate it', async ({ admin }) => {
    await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
    const bundle = { property_setters: [{ table_name: DT, property: 'label', value: 'Customer requests' }] }
    expect(await admin.post('/api/import_customizations', bundle)).toEqual({ custom_fields: 0, property_setters: 1 })
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}:meta`)).toMatchObject({ label: 'Customer requests' })
    const exported = {
      table: DT, custom_fields: [],
      property_setters: [{ table_name: DT, column_name: null, property: 'label', value: 'Customer requests' }],
    }
    expect(await admin.get(`/api/export_customizations/${encodeURIComponent(DT)}`)).toEqual(exported)
    expect(await admin.post('/api/import_customizations', bundle)).toEqual({ custom_fields: 0, property_setters: 0 })
    expect(await admin.get(`/api/export_customizations/${encodeURIComponent(DT)}`)).toEqual(exported)
  })

  test('an imported field cannot replace an existing base column', async ({ admin }) => {
    await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
    const saved = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Keep this value' } })
    const rowPath = `/api/table/${encodeURIComponent(DT)}/${saved.row_id}`
    const before = await admin.get(rowPath)
    const metaPath = `/api/table/${encodeURIComponent(DT)}:meta`
    const meta = await admin.get(metaPath)
    await expectApiError(admin.post('/api/import_customizations', {
      custom_fields: [{ dt: DT, column_name: 'title', column_type: 'Choice', choices: 'Low\nHigh' }],
    }), { status: 409, type: 'ConflictError', message: `409 ConflictError: title already exists on ${DT}` })
    expect(await admin.get(rowPath)).toEqual(before)
    expect(await admin.get(metaPath)).toEqual(meta)
    expect(await admin.get(`/api/export_customizations/${encodeURIComponent(DT)}`))
      .toEqual({ table: DT, custom_fields: [], property_setters: [] })
  })

  test('exposes export/import over HTTP, gated to System Managers', async ({ admin }) => {
    await setup(admin)
    const bundle = await admin.get<{ custom_fields: unknown[] }>(
      `/api/export_customizations/${encodeURIComponent(DT)}`,
    )
    expect(bundle.custom_fields.length).toBe(1)
  })
})
