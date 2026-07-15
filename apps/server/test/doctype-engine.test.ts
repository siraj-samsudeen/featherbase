import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { columnType } from '../src/doctype-engine'
import { app } from '../src/index'

const DT = 'Engine Test Item'

beforeAll(async () => {
  await sql`delete from doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_engine_test_item')
})

afterAll(async () => {
  await sql`delete from doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_engine_test_item')
  await sql.end()
})

describe('META-002: fieldtype -> Postgres column mapping', () => {
  it.each([
    ['Data', 'varchar(140)'],
    ['Int', 'bigint'],
    ['Float', 'double precision'],
    ['Currency', 'numeric(21,9)'],
    ['Check', 'boolean'],
    ['Select', 'text'],
    ['Date', 'date'],
    ['Datetime', 'timestamptz'],
    ['Text', 'text'],
    ['Long Text', 'text'],
    ['Link', 'varchar(140)'],
    ['Attach', 'text'],
    ['JSON', 'jsonb'],
  ])('%s -> %s', (ft, col) => {
    expect(columnType(ft)).toBe(col)
  })

  it.each([['Table'], ['Section Break'], ['Column Break']])(
    '%s produces no column',
    (ft) => {
      expect(columnType(ft)).toBeNull()
    },
  )

  it('throws on unknown fieldtype', () => {
    expect(() => columnType('Bogus')).toThrow()
  })
})

describe('META-002: DocType save validates fieldtypes', () => {
  it('rejects an invalid fieldtype with a field-wise error', async () => {
    const res = await app.request('/api/doctype', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Type DT',
        fields: [{ fieldname: 'x', fieldtype: 'Wibble' }],
      }),
    })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.type).toBe('ValidationError')
    expect(JSON.stringify(body.error.fields)).toContain('fieldtype')
  })

  it('rejects Select/Link/Table fields without options', async () => {
    const res = await app.request('/api/doctype', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Options DT',
        fields: [{ fieldname: 'status', fieldtype: 'Select' }],
      }),
    })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.fields.status).toMatch(/requires options/)
  })

  it('rejects reserved fieldnames', async () => {
    const res = await app.request('/api/doctype', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Reserved DT',
        fields: [{ fieldname: 'owner', fieldtype: 'Data' }],
      }),
    })
    expect(res.status).toBe(417)
  })

  it('accepts a valid definition, persists rows, and 409s on duplicate', async () => {
    const def = {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', reqd: true },
        { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed' },
      ],
    }
    const res = await app.request('/api/doctype', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(def),
    })
    expect(res.status).toBe(201)
    const meta = await res.json()
    expect(meta.fields).toHaveLength(2)

    const dup = await app.request('/api/doctype', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(def),
    })
    expect(dup.status).toBe(409)
  })
})
