import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { pgType } from '../src/table-engine'

const DT = 'Engine Test Item'

describe('META-002: column_type -> Postgres column mapping', () => {
  test.each([
    ['Data', 'varchar(140)'],
    ['Int', 'bigint'],
    ['Float', 'double precision'],
    ['Currency', 'numeric(21,9)'],
    ['Check', 'boolean'],
    ['Choice', 'text'],
    ['Date', 'date'],
    ['Datetime', 'timestamptz'],
    ['Text', 'text'],
    ['Long Text', 'text'],
    ['Reference', 'varchar(140)'],
    ['Attach', 'text'],
    ['JSON', 'jsonb'],
  ])('%s -> %s', (ft, col) => {
    expect(pgType(ft)).toBe(col)
  })

  test.each([['Sub-table'], ['Section Break'], ['Column Break']])(
    '%s produces no column',
    (ft) => {
      expect(pgType(ft)).toBeNull()
    },
  )

  test('throws on unknown column_type', () => {
    expect(() => pgType('Bogus')).toThrow()
  })
})

describe('META-002: Table save validates column_types', () => {
  test('rejects an invalid column_type with a field-wise error', async ({ admin }) => {
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bad Type DT',
        columns: [{ column_name: 'x', column_type: 'Wibble' }],
      }),
    })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.type).toBe('ValidationError')
    expect(JSON.stringify(body.error.fields)).toContain('column_type')
  })

  test('rejects Choice/Reference/Sub-table columns without their target', async ({ admin }) => {
    await expect(
      admin.post('/api/table_def', {
        name: 'Bad Options DT',
        columns: [{ column_name: 'stage', column_type: 'Reference' }],
      }),
    ).rejects.toMatchObject({
      status: 417,
      fields: { stage: expect.stringMatching(/requires reference_table/) },
    })
  })

  test('rejects reserved column names', async ({ admin }) => {
    await expect(
      admin.post('/api/table_def', {
        name: 'Bad Reserved DT',
        columns: [{ column_name: 'created_by', column_type: 'Data' }],
      }),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('accepts a valid definition, persists rows, and 409s on duplicate', async ({ admin }) => {
    const def = {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', reqd: true },
        { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed' },
      ],
    }
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify(def),
    })
    expect(res.status).toBe(201)
    const meta = await res.json()
    expect(meta.columns).toHaveLength(2)

    const dup = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify(def),
    })
    expect(dup.status).toBe(409)
  })
})
