import { describe, expect, it } from 'vitest'
import { comparable, rowMatches } from '../src/approval-rules'
import type { TableMeta } from '../src/meta'

// #627: a rule's rows, held against one row in memory (a held new row is not in the Table yet),
// read the list filter language the same way a list does.
const meta = { name: 'Shelf', columns: [
  { column_name: 'site', column_type: 'Data' }, { column_name: 'bay', column_type: 'Int' },
  { column_name: 'opened', column_type: 'Date' }, { column_name: 'active', column_type: 'Check' },
] } as unknown as TableMeta
const row = { row_id: 'S-1', site: 'North A', bay: 4, opened: new Date('2026-11-01T00:00:00Z'), active: 1 }
const holds = (filters: unknown[] | null) => rowMatches(meta, row, filters)

describe('a rule\'s rows', () => {
  it('no filter covers every row', () => {
    expect(holds(null)).toBe(true)
    expect(holds([])).toBe(true)
  })
  it('equality, inequality and lists', () => {
    expect(holds([['site', '=', 'North A']])).toBe(true)
    expect(holds([['site', '!=', 'North A']])).toBe(false)
    expect(holds([['site', 'in', ['South', 'North A']]])).toBe(true)
    expect(holds([['site', 'not in', ['South']]])).toBe(true)
    expect(holds([['site', 'in', 'North A']])).toBe(false)
    expect(holds([['row_id', '=', 'S-1']])).toBe(true)
  })
  it('patterns and presence', () => {
    expect(holds([['site', 'like', 'north%']])).toBe(true)
    expect(holds([['site', 'like', 'Sou_h']])).toBe(false)
    expect(holds([['site', 'not like', 'South%']])).toBe(true)
    expect(holds([['bay', 'is', 'set']])).toBe(true)
    expect(holds([['bay', 'is', 'not set']])).toBe(false)
    expect(rowMatches(meta, { site: null }, [['site', 'not like', 'x%']])).toBe(true)
    expect(rowMatches(meta, { site: null }, [['site', 'like', '%']])).toBe(false)
  })
  it('ranges compare numbers as numbers and days as days', () => {
    expect(holds([['bay', '>', 3], ['bay', '<', 10]])).toBe(true)
    expect(holds([['bay', '>=', 5]])).toBe(false)
    expect(holds([['bay', '<=', 4]])).toBe(true)
    expect(holds([['opened', '>=', '2026-11-01']])).toBe(true)
    expect(holds([['opened', '<', '2026-11-01']])).toBe(false)
    expect(rowMatches(meta, { bay: null }, [['bay', '>', 1]])).toBe(false)
    expect(holds([['bay', '>', null]])).toBe(false)
  })
  it('a Check column reads as ticked or not', () => {
    expect(holds([['active', '=', true]])).toBe(true)
    expect(holds([['active', '=', '0']])).toBe(false)
  })
})

describe('a value as history compares it', () => {
  it('empty is nothing; days, instants, objects and booleans read the same each time', () => {
    expect(comparable('')).toBeNull()
    expect(comparable(undefined)).toBeNull()
    expect(comparable(new Date('2026-11-01T05:00:00Z'), 'Date')).toBe('2026-11-01')
    expect(comparable(new Date('2026-11-01T05:00:00Z'), 'Datetime')).toBe('2026-11-01T05:00:00.000Z')
    expect(comparable('2026-11-01T05:00:00Z', 'Date')).toBe('2026-11-01')
    expect(comparable({ a: 1 })).toBe('{"a":1}')
    expect(comparable(false)).toBe('0')
    expect(comparable('true', 'Check')).toBe('1')
    expect(comparable(0, 'Check')).toBe('0')
    expect(comparable(7)).toBe('7')
  })
})
