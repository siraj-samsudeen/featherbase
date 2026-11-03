import { describe, expect, it } from 'vitest'
import { pickerFor, referenceLabel, usesRowTitle } from './pickers'

describe('reference titles', () => {
  it('uses configured titles and falls back to codes', () => {
    expect(pickerFor('Supplier', 'supplier_name')).toMatchObject({ searchField: 'supplier_name', labelField: 'supplier_name' })
    expect(referenceLabel('1100', 'Example Retail')).toBe('Example Retail (1100)')
    expect(referenceLabel('1100', null)).toBe('1100')
    expect(referenceLabel('1100', '  ')).toBe('1100')
    expect(referenceLabel('1100', '1100')).toBe('1100')
    expect(pickerFor('Untitled')).toMatchObject({ searchField: 'row_id', labelField: null })
  })
  it('preserves dedicated principal pickers', () => {
    expect(pickerFor('Person', 'ignored')).toMatchObject({ searchField: 'full_name', peopleSearch: true })
    expect(pickerFor('Service Account', 'ignored')).toMatchObject({ searchField: 'label', labelField: 'label' })
    expect(usesRowTitle('Person')).toBe(false)
    expect(usesRowTitle('Service Account')).toBe(false)
    expect(usesRowTitle('Supplier')).toBe(true)
  })
})
