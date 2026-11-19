// #1349: the count row counts a Table's label: "1 Plant", "3 Plants", "31 People", "214 Subcategories". Made-up names.
import { describe, expect, test } from 'vitest'
import { countedLabel } from '@featherbase/shop-floor'

describe('a counted label', () => {
  test('one stays as the Table names it', () => expect(countedLabel('Store Floor', 1)).toBe('Store Floor'))
  test('more take the plural of the last word', () => {
    expect(countedLabel('Store Floor', 4)).toBe('Store Floors')
    expect(countedLabel('Subcategory', 214)).toBe('Subcategories')
    expect(countedLabel('Business Day', 0)).toBe('Business Days')
    expect(countedLabel('Branch', 2)).toBe('Branches')
    expect(countedLabel('Status', 2)).toBe('Statuses')
  })
  test("the irregular words Featherbase's Tables use", () => {
    expect(countedLabel('Person', 31)).toBe('People')
    expect(countedLabel('Sales person', 2)).toBe('Sales people')
    expect(countedLabel('Staff', 9)).toBe('Staff')
  })
})
