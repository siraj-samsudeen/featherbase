import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { getMeta } from '../src/meta'

describe('META-012: DocType and DocField are themselves DocTypes', () => {
  test('getMeta("DocType") works and declares a fields child table', async () => {
    const meta = await getMeta('DocType')
    expect(meta.autoname).toBe('prompt')
    const table = meta.fields.find((f) => f.fieldname === 'fields')
    expect(table).toMatchObject({ fieldtype: 'Table', options: 'DocField' })
  })

  test('GET /api/resource/DocType lists DocTypes including DocType itself', async ({ admin }) => {
    const body = await admin.get<{ data: { name: string; istable: boolean }[] }>(
      `/api/resource/DocType?${new URLSearchParams({
        filters: JSON.stringify([['name', 'in', ['DocType', 'DocField']]]),
        fields: JSON.stringify(['name', 'istable']),
        order_by: 'name asc',
      })}`,
    )
    expect(body.data).toEqual([
      { name: 'DocField', istable: true },
      { name: 'DocType', istable: false },
    ])
  })

  test('GET /api/resource/DocType/<name> returns a DocType doc with its fields as children', async ({
    admin,
  }) => {
    const doc = await admin.get<{ fields: { fieldname: string }[] }>(
      '/api/resource/DocType/DocField',
    )
    expect(doc.fields.map((f) => f.fieldname)).toContain('fieldtype')
  })

  test('generic writes/deletes to DocType/DocField are refused', async ({ admin }) => {
    await expect(
      admin.post('/api/save_doc', { doctype: 'DocType', doc: { module: 'X' } }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(admin.delete('/api/resource/DocType/DocField')).rejects.toMatchObject({
      status: 417,
    })
  })
})
