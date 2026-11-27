// A runtime page's state lives in its address (#1410): a state key is a
// query-string key, and the definition's defaults say what type each one is.
import { describe, expect, test } from 'vitest'
import { searchWithState, stateFromSearch } from '../src/runtime/address'

const DEFAULTS = { measure: 'quantity', open: '', top: 10, returns: false }

describe('reading state from the address', () => {
  test('a key the address does not carry has its default', () => {
    expect(stateFromSearch(DEFAULTS, {})).toEqual(DEFAULTS)
  })

  test('a key the address carries has the address\'s value', () => {
    expect(stateFromSearch(DEFAULTS, { measure: 'value' }).measure).toBe('value')
  })

  test('a key that is not state is left out', () => {
    expect(stateFromSearch(DEFAULTS, { walk: 'x' })).toEqual(DEFAULTS)
  })

  test.each([
    ['open', 2026, '2026'], ['open', true, 'true'],
    ['top', '25', 25], ['top', 25, 25],
    ['returns', true, true], ['returns', 'true', true], ['returns', 'false', false],
  ])('%s=%j is read as %j, the type of its default', (key, given, read) => {
    expect(stateFromSearch(DEFAULTS, { [key]: given })[key]).toBe(read)
  })

  test.each([['top', 'many'], ['top', true], ['returns', 'perhaps'], ['open', { a: 1 }], ['measure', null]])('%s=%j cannot be its default\'s type, so the default stands', (key, given) => {
    expect(stateFromSearch(DEFAULTS, { [key]: given })[key]).toBe(DEFAULTS[key as keyof typeof DEFAULTS])
  })
})

describe('writing state to the address', () => {
  test('a changed key is added, beside what the address already held', () => {
    expect(searchWithState(DEFAULTS, { walk: 'x' }, { measure: 'value' })).toEqual({ walk: 'x', measure: 'value' })
  })

  test('a key set back to its default leaves the address', () => {
    expect(searchWithState(DEFAULTS, { measure: 'value', open: 'Stationery' }, { measure: 'quantity' })).toEqual({ open: 'Stationery' })
  })

  test('a value is kept in its default\'s type', () => {
    expect(searchWithState(DEFAULTS, {}, { top: '25' })).toEqual({ top: 25 })
  })

  test('a name that is not state changes nothing', () => {
    expect(searchWithState(DEFAULTS, {}, { colour: 'red' })).toEqual({})
  })
})
