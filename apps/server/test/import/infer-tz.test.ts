import { afterAll, describe, expect, test } from 'vitest'
import { coerceRows, inferColumnType } from 'shared'

// IMP-002/IMP-004 under a non-UTC clock. SheetJS (cellDates: true) parses a
// date-only STRING like "2026-01-15" to UTC midnight, while an xlsx date CELL
// becomes local midnight. Inference and coercion must treat both as the same
// calendar day on every machine — these tests pin that by switching TZ, which
// Node picks up at runtime for all Date local-component reads.

const originalTz = process.env.TZ

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const dateColumn = [{ column_name: 'due', column_type: 'Date' }]

describe('east of UTC (Asia/Calcutta, +05:30)', () => {
  test('a UTC-midnight Date (parsed date-only string) still infers as Date', () => {
    process.env.TZ = 'Asia/Calcutta'
    const d = new Date('2026-01-15') // UTC midnight = 05:30 local
    expect(d.getHours()).toBe(5) // guard: TZ switch is in effect
    expect(inferColumnType([d])).toBe('Date')
  })

  test('a local-midnight Date (xlsx date cell) still infers as Date', () => {
    process.env.TZ = 'Asia/Calcutta'
    expect(inferColumnType([new Date(2026, 0, 15)])).toBe('Date')
  })

  test('a Date with a real time part still infers as Datetime', () => {
    process.env.TZ = 'Asia/Calcutta'
    expect(inferColumnType([new Date(2026, 0, 15, 10, 30)])).toBe('Datetime')
  })

  test('coercion keeps the calendar day of a UTC-midnight Date', () => {
    process.env.TZ = 'Asia/Calcutta'
    expect(coerceRows(dateColumn, [[new Date('2026-01-15')]])).toEqual([
      { values: { due: '2026-01-15' }, sourceIndex: 0 },
    ])
  })
})

describe('west of UTC (America/New_York, -05:00)', () => {
  test('a UTC-midnight Date infers as Date', () => {
    process.env.TZ = 'America/New_York'
    const d = new Date('2026-01-15') // UTC midnight = 19:00 local, previous day
    expect(d.getHours()).toBe(19) // guard: TZ switch is in effect
    expect(inferColumnType([d])).toBe('Date')
  })

  test('coercion must not shift the day backwards', () => {
    process.env.TZ = 'America/New_York'
    expect(coerceRows(dateColumn, [[new Date('2026-01-15')]])).toEqual([
      { values: { due: '2026-01-15' }, sourceIndex: 0 },
    ])
  })

  test('a local-midnight Date keeps its local calendar day', () => {
    process.env.TZ = 'America/New_York'
    expect(coerceRows(dateColumn, [[new Date(2026, 0, 15)]])).toEqual([
      { values: { due: '2026-01-15' }, sourceIndex: 0 },
    ])
  })
})
