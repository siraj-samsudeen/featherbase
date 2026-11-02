import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import type { TestClient } from 'feather-testing-postgres'
import { expectApiError } from './fixtures'

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
  return admin.fetch('/api/save_row', {
    method: 'POST',
    body: JSON.stringify({
      table: 'Metadata Override',
      row: {
        row_id: `${DT}-title-label`,
        table_name: DT,
        column_name: 'title',
        property: 'label',
        value: 'Headline',
      },
    }),
  })
}

describe('CUST-002: metadata overrides', () => {
  test('refuses a column label used as its name', async ({ admin }) => {
    await makeDT(admin)
    await expectApiError(admin.post('/api/save_row', {
      table: 'Metadata Override',
      row: { row_id: 'ps-invalid-column', table_name: DT, column_name: 'Title', property: 'label', value: 'Headline' },
    }), { status: 417, type: 'ValidationError', message: expect.stringContaining(`Column Title not found on Table ${DT}`) })
    await expectApiError(admin.get('/api/table/Metadata%20Override/ps-invalid-column'), { status: 404 })
  })

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

  for (const [value, expected] of [['true', true], ['false', false], ['1', true], ['0', false]] as const) {
    test(`applies boolean text ${value}`, async ({ admin }) => {
      await makeDT(admin)
      await admin.post('/api/save_row', {
        table: 'Metadata Override',
        row: { row_id: `${DT}-title-reqd`, table_name: DT, column_name: 'title', property: 'reqd', value },
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
      const error = await expectApiError(admin.post('/api/save_row', {
        table: 'Metadata Override',
        row: { row_id: 'ps-invalid-boolean', table_name: DT, column_name: 'title', property, value },
      }), { status: 417, type: 'ValidationError' })
      for (const allowed of ['true', 'false', '1', '0']) expect(error.message).toContain(allowed)
      await expectApiError(admin.get('/api/table/Metadata%20Override/ps-invalid-boolean'), { status: 404 })
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
