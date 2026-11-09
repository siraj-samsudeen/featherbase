import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import type { TestClient } from 'feather-testing-postgres'
import { expectApiError, expectRefused, expectStatus, patchDoc, tableRef } from './fixtures'

// CUST-002: Metadata Overrides override column/Table properties without
// touching the base definition.

const DT = 'Ps Target'

async function makeDT(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
  })
}

async function addLabelSetter(admin: TestClient) {
  return admin.fetch('/api/table/Metadata%20Override', {
    method: 'POST',
    body: JSON.stringify({
      row_id: `${DT}-title-label`,
      table_name: DT,
      column_name: 'title',
      property: 'label',
      value: 'Headline',
    }),
  })
}

describe('CUST-002: metadata overrides', () => {
  test('#800 existing and new Tables default every collaboration flag to false over HTTP', async ({ admin }) => {
    await makeDT(admin)
    const tables = await sql<{ name: string }[]>`select name from table_def order by name`
    for (const { name } of tables) {
      expect(await admin.get(tableRef(name).metaUrl)).toMatchObject({
        enable_assignments: false, enable_tags: false, enable_files: false, enable_discussion: false,
      })
    }
  })

  test('#800 a mistyped enablement value is refused rather than silently disabling the feature', async ({ admin }) => {
    await makeDT(admin)
    const response = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Metadata Override', row: {
        table_name: DT, property: 'enable_tags', value: 'yes',
      } }),
    })
    await expectStatus(response, 417)
    expect(await response.json()).toMatchObject({ error: { type: 'ValidationError' } })
    expect(await admin.get(tableRef(DT).metaUrl)).toMatchObject({ enable_tags: false })
  })

  for (const property of ['enable_assignments', 'enable_tags', 'enable_files', 'enable_discussion']) {
    test(`#800 ${property} independently enables and invalidates warmed HTTP metadata on edit and delete`, async ({ admin }) => {
      await makeDT(admin)
      const metaUrl = tableRef(DT).metaUrl
      const defaults = { enable_assignments: false, enable_tags: false, enable_files: false, enable_discussion: false }
      expect(await admin.get(metaUrl)).toMatchObject(defaults)
      const saved = await admin.post<{ row_id: string }>('/api/save_row', {
        table: 'Metadata Override',
        row: { table_name: DT, property, value: '1' },
      })
      expect(await admin.get(metaUrl)).toMatchObject({ ...defaults, [property]: true })
      const overrideUrl = tableRef('Metadata Override').rowUrl(saved.row_id)
      // An edited override has retained history and is intentionally undeletable.
      // Exercise deletion before editing, then recreate it for the edit checks.
      await admin.delete(overrideUrl)
      expect(await admin.get(metaUrl)).toMatchObject(defaults)
      await admin.post('/api/table/Metadata%20Override', {
        row_id: saved.row_id, table_name: DT, property, value: '1',
      })
      expect(await admin.get(metaUrl)).toMatchObject({ ...defaults, [property]: true })
      await patchDoc(admin, overrideUrl, { ...await admin.get(overrideUrl), value: '0' })
      expect(await admin.get(metaUrl)).toMatchObject(defaults)
      await patchDoc(admin, overrideUrl, { ...await admin.get(overrideUrl), value: 'true' })
      expect(await admin.get(metaUrl)).toMatchObject({ ...defaults, [property]: true })
    })
  }

  test('refuses a column label used as its name', async ({ admin }) => {
    await makeDT(admin)
    await expectApiError(admin.post('/api/table/Metadata%20Override', {
      row_id: 'ps-invalid-column', table_name: DT, column_name: 'Title', property: 'label', value: 'Headline',
    }), { status: 417, type: 'ValidationError', message: expect.stringContaining(`Column Title not found on Table ${DT}`) })
    await expectRefused(admin.get('/api/table/Metadata%20Override/ps-invalid-column'), 404)
  })

  test('overrides a column label in effective meta but leaves the base row unchanged', async ({
    admin,
  }) => {
    await makeDT(admin)
    const res = await addLabelSetter(admin)
    await expectStatus(res, 201)

    const meta = await getMeta(DT)
    expect(meta.columns.find((f) => f.column_name === 'title')?.label).toBe('Headline')

    // Base column_def row untouched.
    const [row] = await sql`select label from column_def where parent = ${DT} and column_name = 'title'`
    expect(row.label).toBe('Title')
  })

  for (const [value, expected] of [['true', true], ['false', false], ['1', true], ['0', false]] as const) {
    test(`applies boolean text ${value}`, async ({ admin }) => {
      await makeDT(admin)
      await admin.post('/api/table/Metadata%20Override', {
        row_id: `${DT}-title-reqd`, table_name: DT, column_name: 'title', property: 'reqd', value,
      })
      const meta = await getMeta(DT)
      expect(meta.columns.find((column) => column.column_name === 'title')?.reqd).toBe(expected)
      const [row] = await sql`select reqd from column_def where parent = ${DT} and column_name = 'title'`
      expect(row.reqd).toBe(false)
    })
  }

  for (const [property, value] of [
    ['hidden', 'truetrue'], ['reqd', 'yes'], ['read_only', '2'], ['in_list_view', ''],
    ['hidden', undefined], ['hidden', null], ['hidden', 'constructor'],
  ]) {
    test(`refuses invalid ${property} value ${String(value)}`, async ({ admin }) => {
      await makeDT(admin)
      const error = await expectApiError(admin.post('/api/table/Metadata%20Override', {
        row_id: 'ps-invalid-boolean', table_name: DT, column_name: 'title', property, value,
      }), { status: 417, type: 'ValidationError' })
      for (const allowed of ['true', 'false', '1', '0']) expect(error.message).toContain(allowed)
      await expectRefused(admin.get('/api/table/Metadata%20Override/ps-invalid-boolean'), 404)
    })
  }

  for (const column of [null, 'title']) {
    test(`lists permitted properties for ${column ? 'column' : 'Table'} overrides`, async ({ admin }) => {
      await makeDT(admin)
      const error = await expectApiError(admin.post('/api/table/Metadata%20Override', {
        row_id: 'ps-invalid-property', table_name: DT, column_name: column, property: 'unique', value: 'true',
      }), { status: 417, type: 'ValidationError' })
      expect(error.message.split('Permitted properties: ')[1]).toBe(column
        ? 'label, hidden, reqd, read_only, in_list_view, default_value, choices'
        : 'label, title_column, search_columns, sort_column, sort_direction, enable_assignments, enable_tags, enable_files, enable_discussion')
    })
  }

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
