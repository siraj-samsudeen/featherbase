// #1269: a store's subcategories collapse to the shortest prefixes the reader wholly holds, and never wider.
// Made-up codes in the shape of SAP's: 2 digits line of business, 4 main category, 6 category, 9 subcategory.
import { describe, expect, it } from 'vitest'
import { collapseCodes } from './reach-prefixes'

/** A made-up hierarchy: line 92 has two main categories (9201: two categories; 9202: one); line 93 one category. */
const EVERY = ['920101001', '920101002', '920102001', '920201001', '920201002', '930101001', '930101002']
const under = (prefix: string) => EVERY.filter(code => code.startsWith(prefix))

describe('collapsing a store\'s subcategories', () => {
  it('sends a whole line of business as its 2-digit code', () => {
    expect(collapseCodes([...under('92'), ...under('93')], EVERY)).toEqual(['92', '93'])
  })

  it('sends a whole main category as 4 digits when its line is not wholly held', () => {
    expect(collapseCodes(under('9201'), EVERY)).toEqual(['9201'])
  })

  it('sends a whole category as 6 digits when its main category is not wholly held', () => {
    expect(collapseCodes(under('920101'), EVERY)).toEqual(['920101'])
  })

  it('keeps a category missing one subcategory as its codes, never its prefix', () => {
    expect(collapseCodes(['920101001'], EVERY)).toEqual(['920101001'])
    // The rest of the line collapses; the category short of one stays codes.
    expect(collapseCodes(['920101001', '920102001', ...under('9202')], EVERY)).toEqual(['920101001', '920102', '9202'])
  })

  it('keeps a line as codes when a code of another type sits under it', () => {
    const merchandise = under('93')
    expect(collapseCodes(merchandise, [...EVERY, '930199001'])).toEqual(['930101'])
    expect(collapseCodes(merchandise, [...EVERY, '930101009'])).toEqual(merchandise)
  })

  it('sends a code the hierarchy does not know as itself, and never collapses on it', () => {
    expect(collapseCodes(['990000001', ...under('93')], EVERY)).toEqual(['93', '990000001'])
  })

  it('collapses nothing when the hierarchy is empty', () => {
    expect(collapseCodes(['920101002', '920101001'], [])).toEqual(['920101001', '920101002'])
  })

  it('sends a division-head-shaped reach in a few hundred bytes', () => {
    // 25 plants × two whole lines of business of 695 codes between them.
    const every = Array.from({ length: 695 }, (_, i) => `${i < 400 ? '92' : '93'}${String(i).padStart(7, '0')}`)
    const reach = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(9901 + i), collapseCodes(every, every)]))
    expect(reach['9901']).toEqual(['92', '93'])
    expect(JSON.stringify(reach).length).toBeLessThan(600)
  })
})
