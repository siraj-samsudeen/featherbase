import { afterAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { areq } from './helpers'

afterAll(async () => {
  await sql.end()
})

describe('META-012: DocType and DocField are themselves DocTypes', () => {
  it('getMeta("DocType") works and declares a fields child table', async () => {
    const meta = await getMeta('DocType')
    expect(meta.autoname).toBe('prompt')
    const table = meta.fields.find((f) => f.fieldname === 'fields')
    expect(table).toMatchObject({ fieldtype: 'Table', options: 'DocField' })
  })

  it('GET /api/resource/DocType lists DocTypes including DocType itself', async () => {
    const res = await areq(
      `/api/resource/DocType?${new URLSearchParams({
        filters: JSON.stringify([['name', 'in', ['DocType', 'DocField']]]),
        fields: JSON.stringify(['name', 'istable']),
        order_by: 'name asc',
      })}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { name: string; istable: boolean }[] }
    expect(body.data).toEqual([
      { name: 'DocField', istable: true },
      { name: 'DocType', istable: false },
    ])
  })

  it('GET /api/resource/DocType/<name> returns a DocType doc with its fields as children', async () => {
    const res = await areq('/api/resource/DocType/DocField')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as { fields: { fieldname: string }[] }
    expect(doc.fields.map((f) => f.fieldname)).toContain('fieldtype')
  })

  it('generic writes/deletes to DocType/DocField are refused', async () => {
    const save = await areq('/api/save_doc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doctype: 'DocType', doc: { module: 'X' } }),
    })
    expect(save.status).toBe(417)
    const del = await areq('/api/resource/DocType/DocField', { method: 'DELETE' })
    expect(del.status).toBe(417)
  })
})
