import { describe, expect, it } from 'vitest'
import { columnNamingPattern, idFromColumn, namingColumn, renameNamingColumn } from '../src/naming'

// #858: the rules that name a row after one of its columns.
describe('column naming rules', () => {
  it('reads the column, and the prefix before it', () => {
    expect(namingColumn('field:plant_code')).toEqual({ prefix: '', column: 'plant_code' })
    expect(namingColumn('PLANT-{plant_code}')).toEqual({ prefix: 'PLANT-', column: 'plant_code' })
  })

  it('is not a column rule for the other kinds, or for nothing', () => {
    for (const pattern of ['integer', 'hash', 'prompt', 'INV-.###', 'opaque:psn_', '{plant_code}', 'A-{x}-B', '', null, undefined])
      expect(namingColumn(pattern)).toBeNull()
  })

  it('writes the rule back, with or without a prefix', () => {
    expect(columnNamingPattern('PLANT-', 'plant_code')).toBe('PLANT-{plant_code}')
    expect(columnNamingPattern('', 'plant_code')).toBe('field:plant_code')
  })

  it('gives the id a value makes, and none for a blank value', () => {
    expect(idFromColumn('PLANT-', ' 8151 ')).toBe('PLANT-8151')
    expect(idFromColumn('', 8151)).toBe('8151')
    expect(idFromColumn('PLANT-', '  ')).toBeNull()
    expect(idFromColumn('PLANT-', null)).toBeNull()
  })

  it('follows a renamed naming column and leaves other rules alone', () => {
    expect(renameNamingColumn('PLANT-{plant_code}', 'plant_code', 'sap_code')).toBe('PLANT-{sap_code}')
    expect(renameNamingColumn('field:plant_code', 'plant_code', 'sap_code')).toBe('field:sap_code')
    expect(renameNamingColumn('PLANT-{city}', 'plant_code', 'sap_code')).toBe('PLANT-{city}')
    expect(renameNamingColumn('INV-.###', 'plant_code', 'sap_code')).toBe('INV-.###')
    expect(renameNamingColumn(undefined, 'plant_code', 'sap_code')).toBeUndefined()
  })
})
