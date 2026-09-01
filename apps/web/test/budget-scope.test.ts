// Spec 0007 BUD-R15, the reading half. Pure functions over a scope object —
// no database, no React — so this file uses vitest's plain `test`, not the
// sandboxed fixture: there is nothing to roll back. The composer and the
// ledger both go through these, which is the point: the words a person
// chooses and the words they read back cannot drift apart.

import { describe, test, expect } from 'vitest'
import { formatScope, parseScope } from '../src/lib/budget-scope'

const KEYS = ['region', 'store']

describe('BUD-R15: a scope reads back in words', () => {
  test('BUD-R15: every declared dimension is named — the pinned ones by value, the open ones as all', () => {
    expect(formatScope({ region: 'Kerala' }, KEYS)).toBe('region: Kerala · store: all')
    expect(formatScope({ region: 'Kerala', store: '1501' }, KEYS)).toBe(
      'region: Kerala · store: 1501',
    )
    // An explicit null is the same statement as an absence (the engine
    // normalizes it away), so it must read the same too.
    expect(formatScope({ region: 'Kerala', store: null }, KEYS)).toBe('region: Kerala · store: all')
    expect(formatScope({}, KEYS)).toBe('region: all · store: all')
  })

  test('BUD-R15: a scope arrives as JSON text or as an object, and reads the same either way', () => {
    expect(formatScope('{"region":"Kerala"}', KEYS)).toBe('region: Kerala · store: all')
    expect(parseScope('{"region":"Kerala"}')).toEqual({ region: 'Kerala' })
    expect(parseScope({ region: 'Kerala' })).toEqual({ region: 'Kerala' })
  })

  test('BUD-R15: an unreadable scope renders as nothing pinned rather than breaking the ledger row', () => {
    // Append-only means a stored row can never be repaired (BUD-R16), so the
    // surface must still render one whose scope it cannot parse.
    expect(parseScope('not json')).toEqual({})
    expect(parseScope('[1,2]')).toEqual({})
    expect(parseScope(null)).toEqual({})
    expect(parseScope('')).toEqual({})
    expect(parseScope(['a'])).toEqual({})
    expect(formatScope('not json', KEYS)).toBe('region: all · store: all')
    // With no declared columns to fall back on there is nothing to name.
    expect(formatScope({}, [])).toBe('all')
    expect(formatScope({ region: 'Kerala' }, [])).toBe('region: Kerala')
  })
})
