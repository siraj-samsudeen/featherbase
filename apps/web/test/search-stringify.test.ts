import { describe, expect, test } from 'vitest'
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router'
import { filterValueLabel } from '../src/components/ListView'

// #106 review: pins the invariant main.tsx's stringifySearch wrapper relies
// on — the default stringifier emits a LITERAL '+' as %2B, so a raw '+' in
// its output can only ever mean a space, and rewriting '+' → %20 therefore
// round-trips every value exactly through defaultParseSearch. If a router
// upgrade ever changes '+' emission, this fails before the app corrupts.

const stringifySearch = (search: Record<string, unknown>) =>
  defaultStringifySearch(search).replace(/\+/g, '%20')

function roundTrip(value: string): unknown {
  return (defaultParseSearch(stringifySearch({ q: value })) as Record<string, unknown>).q
}

describe('search stringify wrapper', () => {
  test('a value with spaces round-trips exactly', () => {
    expect(roundTrip('PO Line')).toBe('PO Line')
  })

  test('a literal + round-trips exactly (the safety condition)', () => {
    expect(roundTrip('a+b')).toBe('a+b')
    // and the default stringifier really does emit it as %2B, never raw '+'
    expect(defaultStringifySearch({ q: 'a+b' })).toContain('%2B')
  })

  test('space and literal + together round-trip exactly', () => {
    expect(roundTrip('%A+B Metals%')).toBe('%A+B Metals%')
  })

  test('a full related-filter payload round-trips exactly', () => {
    const filters = JSON.stringify([
      ['name', 'related', { via: 'PO Line', column: 'item', table: 'Item', filters: [['name', '=', 'ITM-002']] }],
    ])
    expect(roundTrip(filters)).toBe(filters)
  })
})

describe('filterValueLabel', () => {
  test('related specs name their target', () => {
    expect(filterValueLabel('related', { table: 'Supplier' })).toBe('Supplier')
    expect(filterValueLabel('related', { table: 'Item', via: 'PO Line' })).toBe('Item via PO Line')
  })

  test('long in-lists truncate, short ones render fully', () => {
    expect(filterValueLabel('in', ['a', 'b'])).toBe('a, b')
    expect(filterValueLabel('in', ['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c +2')
  })

  test('scalars pass through', () => {
    expect(filterValueLabel('=', 'Chennai')).toBe('Chennai')
  })
})
