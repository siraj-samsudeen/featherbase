import { describe, expect, test } from 'vitest'
import type { PersonScope } from 'shared'
import { narrowPersonScope } from '../src/person-scope'

// #559: a request may name places or filter values; anything outside the
// person's scope refuses the whole request (null), never a partial answer.
const scope: PersonScope = [
  { label: 'Store 12 / Kids', filters: { store: ['12'], section: ['kids', 'baby'] }, confirmation: { section: { kids: 'confirmed', baby: 'assumed' } } },
  { label: 'Store 13 / Mens', filters: { store: ['13'], section: ['mens'] } },
  { label: 'Store 14', filters: { store: ['14'] }, basis: 'store manager' },
]

describe('narrowing a person scope to what a request names', () => {
  test('a request that names nothing gets the whole scope', () => {
    expect(narrowPersonScope(scope, undefined)).toEqual(scope)
  })

  test('naming a place by its label keeps only that place', () => {
    expect(narrowPersonScope(scope, { places: ['Store 13 / Mens'] })).toEqual([scope[1]])
  })

  test('naming a place outside the scope is refused', () => {
    expect(narrowPersonScope(scope, { places: ['Store 13 / Mens', 'Store 99'] })).toBeNull()
  })

  test('naming a filter value keeps that value in the places that cover it', () => {
    expect(narrowPersonScope(scope, { filters: { section: ['baby'] } })).toEqual([
      { label: 'Store 12 / Kids', filters: { store: ['12'], section: ['baby'] }, confirmation: { section: { baby: 'assumed' } } },
      { label: 'Store 14', filters: { store: ['14'], section: ['baby'] }, basis: 'store manager' },
    ])
  })

  test('naming a filter value no place covers is refused', () => {
    expect(narrowPersonScope(scope, { filters: { store: ['12', '99'] } })).toBeNull()
  })

  test('filter values from two places that no single place joins are refused', () => {
    expect(narrowPersonScope(scope, { filters: { store: ['12'], section: ['mens'] } })).toBeNull()
  })

  test('a named place that the named filter values leave empty is refused', () => {
    expect(narrowPersonScope(scope, { places: ['Store 13 / Mens'], filters: { store: ['12'] } })).toBeNull()
  })

  test.each([
    ['not an object', 'Store 12'],
    ['an unknown key', { stores: ['12'] }],
    ['an empty list of places', { places: [] }],
    ['a filter with no values', { filters: { store: [] } }],
  ])('a request scope that is %s is refused', (_, request) => {
    expect(narrowPersonScope(scope, request)).toBeNull()
  })
})
