import { describe, expect, it } from 'vitest'
import { calendarDay, fmtInstantIST, isCalendarDay, isLocalMidnight, isUtcMidnight } from '../src/dates'

it('accepts real calendar days without normalising an overflowing month, day or year zero', () => {
  expect(isCalendarDay(2024, 2, 29)).toBe(true)
  expect(isCalendarDay(1, 1, 1)).toBe(true)
  for (const [year, month, day] of [
    [2025, 2, 29], [2026, 2, 30], [2026, 13, 1], [2026, 0, 1], [2026, 1, 0], [0, 1, 1],
    [2026.5, 2, 1], [2026, 2.5, 1], [2026, 2, 1.5],
  ]) {
    expect(isCalendarDay(year, month, day)).toBe(false)
  }
})

it('recognises UTC midnight only when every clock component is zero', () => {
  expect(isUtcMidnight(new Date('2026-01-15T00:00:00.000Z'))).toBe(true)
  for (const clock of ['01:00:00.000', '00:01:00.000', '00:00:01.000', '00:00:00.001']) {
    expect(isUtcMidnight(new Date(`2026-01-15T${clock}Z`))).toBe(false)
  }
})

it('recognises local midnight only when every clock component is zero', () => {
  expect(isLocalMidnight(new Date(2026, 0, 15))).toBe(true)
  for (const [hour, minute, second, millisecond] of [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) {
    expect(isLocalMidnight(new Date(2026, 0, 15, hour, minute, second, millisecond))).toBe(false)
  }
})

it('keeps the written calendar day for local and UTC midnight on either side of UTC', () => {
  const original = process.env.TZ
  try {
    for (const zone of ['Asia/Kolkata', 'America/New_York']) {
      process.env.TZ = zone
      expect(calendarDay(new Date(2026, 0, 15))).toBe('2026-01-15')
      expect(calendarDay(new Date('2026-01-15T00:00:00.000Z'))).toBe('2026-01-15')
      expect(calendarDay(new Date(2026, 0, 15, 23, 30))).toBe('2026-01-15')
    }
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
})

// The one `DD-Mon-YYYY HH:MM IST` formatter, used by the web and by the
// server's instance-health messages (#465).
describe('fmtInstantIST', () => {
  it('renders an ISO instant in IST', () => {
    expect(fmtInstantIST('2026-10-22T09:00:00Z')).toBe('22-Oct-2026 14:30 IST')
  })
  it('takes a Date too, and crosses midnight into the next IST day', () => {
    expect(fmtInstantIST(new Date('2026-12-31T19:00:00Z'))).toBe('01-Jan-2027 00:30 IST')
  })
  it('renders nothing known as a dash', () => {
    expect(fmtInstantIST(null)).toBe('—')
    expect(fmtInstantIST(undefined)).toBe('—')
    expect(fmtInstantIST('')).toBe('—')
    expect(fmtInstantIST('not a date')).toBe('—')
  })
})
