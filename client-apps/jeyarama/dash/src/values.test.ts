// The value helpers Dash's rules read dates and text through.
import { describe, expect, it } from 'vitest'
import { day, holdsOn } from './values'

describe('day', () => {
  it('reads a Date, a text date and nothing', () => {
    expect([day(new Date('2026-11-07T00:00:00Z')), day(new Date('not a date')), day('2026-11-07T10:00'), day(null)]).toEqual(['2026-11-07', '', '2026-11-07', ''])
  })
})

// #1243: ends_on is the last day a row holds, as Featherbase writes it.
describe('holdsOn', () => {
  const row = { starts_on: '2026-11-01', ends_on: '2026-11-15' }
  it('holds from its first day through its last day, inclusive', () => {
    expect(['2026-10-31', '2026-11-01', '2026-11-15', '2026-11-16'].map(d => holdsOn(row, d))).toEqual([false, true, true, false])
  })
  it('holds from its first day on when it has no end, and never without a start', () => {
    expect(holdsOn({ starts_on: '2026-11-01' }, '2030-01-01')).toBe(true)
    expect(holdsOn({ ends_on: '2026-11-15' }, '2026-11-10')).toBe(false)
  })
  it('a change on a day leaves no day uncovered: the old row ends the day before, the new one starts that day', () => {
    const old = { starts_on: '2026-10-01', ends_on: '2026-11-15' }
    const replacement = { starts_on: '2026-11-16' }
    expect([holdsOn(old, '2026-11-15'), holdsOn(replacement, '2026-11-15')]).toEqual([true, false])
    expect([holdsOn(old, '2026-11-16'), holdsOn(replacement, '2026-11-16')]).toEqual([false, true])
  })
})
