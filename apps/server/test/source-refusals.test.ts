// How a write a data source refuses is explained, from the refusal's own
// fields: the cases where the source names less than it usually does.
import { describe, expect, test } from 'vitest'
import { explainRefusal } from '../src/sources/dispatch'
import { REFUSAL_CODE, type Binding } from '../src/sources/types'
import type { TableMeta } from '../src/meta'

const meta = { name: 'Vehicle', columns: [{ column_name: 'code', label: '' }] } as unknown as TableMeta
const bind = { source: { name: 'garage' }, columns: [{ column_name: 'code', source_column: 'code_src', column_type: 'Data' }] } as unknown as Binding

function explained(refusal: Record<string, unknown>): { message: string; fields?: Record<string, string> } {
  try {
    explainRefusal(meta, bind, refusal)
  } catch (e) {
    return e as { message: string; fields?: Record<string, string> }
  }
  throw new Error('explainRefusal returned')
}

describe('a refused write the source explains only in part', () => {
  test('a refusal with no message is still explained', () => {
    expect(explained({ code: REFUSAL_CODE.check }).message).toBe("These values break one of the data source's rules")
  })

  test('a unique refusal with no detail names the row key', () => {
    expect(explained({ code: REFUSAL_CODE.unique, message: 'dup' })).toMatchObject({ message: 'Duplicate value for row_id', fields: { row_id: 'row_id must be unique' } })
  })

  test('a unique refusal on a column the Table does not show names the source column', () => {
    expect(explained({ code: REFUSAL_CODE.unique, detail: 'Key (vin)=(1) already exists.' }).fields).toEqual({ vin: 'vin must be unique' })
  })

  test('a required field with no label is named by its column', () => {
    expect(explained({ code: REFUSAL_CODE.notNull, column_name: 'code_src' }).message).toBe('code is required')
  })

  test('a link refusal with no detail is a link to a row the source does not have', () => {
    expect(explained({ code: REFUSAL_CODE.foreignKey }).message).toBe('Vehicle links to a row the data source does not have')
  })

  test('a value still pointed at on a column the Table does not show names no field', () => {
    expect(explained({ code: REFUSAL_CODE.foreignKey, detail: 'Key (vin)=(1) is still referenced from table "x".' }))
      .toMatchObject({ message: "Other rows at the data source still point at this row's value, so it cannot change", fields: undefined })
  })

  test('a value too long on a column the Table does not show names no field', () => {
    expect(explained({ code: REFUSAL_CODE.tooLong })).toMatchObject({ message: 'Value too long for a field', fields: undefined })
  })

  test('a value out of range on a column the Table does not show names no field', () => {
    expect(explained({ code: REFUSAL_CODE.outOfRange })).toMatchObject({ message: 'Value out of range for a field', fields: undefined })
  })
})
