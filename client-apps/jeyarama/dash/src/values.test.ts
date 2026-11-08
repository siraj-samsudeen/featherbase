// The value helpers Dash's rules read dates and text through.
import { describe, expect, it } from 'vitest'
import { day } from './values'

describe('day', () => {
  it('reads a Date, a text date and nothing', () => {
    expect([day(new Date('2026-11-07T00:00:00Z')), day(new Date('not a date')), day('2026-11-07T10:00'), day(null)]).toEqual(['2026-11-07', '', '2026-11-07', ''])
  })
})
