import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { columnType } from '../src/doctype-engine'

const DT = 'Engine Test Item'

describe('META-002: fieldtype -> Postgres column mapping', () => {
  test.each([
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

  test.each([['Table'], ['Section Break'], ['Column Break']])(
    '%s produces no column',
    (ft) => {
      expect(columnType(ft)).toBeNull()
    },
  )

  test('throws on unknown fieldtype', () => {
    expect(() => columnType('Bogus')).toThrow()
  })
})

describe('META-002: DocType save validates fieldtypes', () => {
  test('rejects an invalid fieldtype with a field-wise error', async ({ admin }) => {
    const res = await admin.fetch('/api/doctype', {
      method: 'POST',
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

  test('rejects Select/Link/Table fields without options', async ({ admin }) => {
    await expect(
      admin.post('/api/doctype', {
        name: 'Bad Options DT',
        fields: [{ fieldname: 'status', fieldtype: 'Select' }],
      }),
    ).rejects.toMatchObject({
      status: 417,
      fields: { status: expect.stringMatching(/requires options/) },
    })
  })

  test('rejects reserved fieldnames', async ({ admin }) => {
    await expect(
      admin.post('/api/doctype', {
        name: 'Bad Reserved DT',
        fields: [{ fieldname: 'owner', fieldtype: 'Data' }],
      }),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('accepts a valid definition, persists rows, and 409s on duplicate', async ({ admin }) => {
    const def = {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', reqd: true },
        { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed' },
      ],
    }
    const res = await admin.fetch('/api/doctype', {
      method: 'POST',
      body: JSON.stringify(def),
    })
    expect(res.status).toBe(201)
    const meta = await res.json()
    expect(meta.fields).toHaveLength(2)

    const dup = await admin.fetch('/api/doctype', {
      method: 'POST',
      body: JSON.stringify(def),
    })
    expect(dup.status).toBe(409)
  })
})
