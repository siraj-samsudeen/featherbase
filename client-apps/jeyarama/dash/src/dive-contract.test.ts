import { describe, expect, it } from 'vitest'
import { diveLink, fitOf, ownerInstruction, reportShapeFor } from './dive-contract'

// The keys the real Jockey Women Dive (v5) reads: its own Store picker, no reach.
const JOCKEY = ['store', 'brand', 'tab', 'range', 'from', 'to', 'openParents']

describe('fitOf (#1225)', () => {
  it('a Dive reading reach shows each person their stores, opening where Dash says when it reads store', () => {
    expect(fitOf(['reach', 'store', 'month'])).toEqual({ kind: 'stores', month: true, openOn: true })
    expect(fitOf(['reach'])).toEqual({ kind: 'stores', month: false, openOn: false })
  })
  it('a Dive reading all three one-store keys takes Dash\'s store', () => {
    expect(fitOf(['plant_code', 'material_groups', 'whole_store', 'month'])).toEqual({ kind: 'one_store', month: true })
  })
  it('a Dive reading only some one-store keys names the missing ones', () => {
    expect(fitOf(['plant_code', 'week'])).toEqual({ kind: 'partly', missing: ['material_groups', 'whole_store'] })
  })
  it('the Jockey Women Dive shows every store: its store is its own picker', () => {
    expect(fitOf(JOCKEY)).toEqual({ kind: 'every_store', ownPicker: ['store'] })
  })
  it('a Dive picking no store shows every store, with no picker of its own', () => {
    expect(fitOf(['month'])).toEqual({ kind: 'every_store', ownPicker: [] })
  })
  it('an unread source is unknown', () => {
    expect(fitOf(null)).toEqual({ kind: 'unknown' })
  })
})

describe('reportShapeFor (#1225)', () => {
  it('reach becomes Stores and subcategories on reach, with the Dive\'s own pickers when it reads store', () => {
    expect(reportShapeFor(fitOf(['reach', 'store']))).toEqual({ filter_shape: 'Stores and subcategories', store_key: 'reach', subcategory_key: null, whole_store_key: null, pickers_in_dive: true })
    expect(reportShapeFor(fitOf(['reach']))?.pickers_in_dive).toBe(false)
  })
  it('the one-store keys become One store and subcategories', () => {
    expect(reportShapeFor(fitOf(['plant_code', 'material_groups', 'whole_store']))).toEqual({ filter_shape: 'One store and subcategories', store_key: 'plant_code', subcategory_key: 'material_groups', whole_store_key: 'whole_store', pickers_in_dive: false })
  })
  it('anything else is not narrowed: no shape', () => {
    for (const reads of [JOCKEY, ['plant_code'], ['month'], null]) expect(reportShapeFor(fitOf(reads))).toBeNull()
  })
})

describe('diveLink (#1225)', () => {
  it('is the title as words then the id, as MotherDuck writes it', () => {
    expect(diveLink('Fashion · Jockey Women — Store SKU/Size Stock, Cover Days & Kerala Transfers', '1c76d636-3af8-45fb-926e-14f6ba6737ad'))
      .toBe('https://app.motherduck.com/dives/fashion-jockey-women-store-skusize-stock-cover-1c76d636-3af8-45fb-926e-14f6ba6737ad')
  })
  it('is just the id for a title with no letters', () => {
    expect(diveLink('—', 'abc')).toBe('https://app.motherduck.com/dives/abc')
  })
})

describe('ownerInstruction (#1225)', () => {
  it('names the Dive, its link and every key', () => {
    const text = ownerInstruction('Stock', 'https://x/dives/stock-1')
    for (const part of ['"Stock"', 'https://x/dives/stock-1', 'reach', 'store', 'month', "useDiveState('reach', null)", 'never every store']) expect(text).toContain(part)
  })
})
