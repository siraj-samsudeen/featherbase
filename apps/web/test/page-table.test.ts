// What a runtime page's Table part works out before it draws (#1410): its
// groups, a group's total and a cell's text. Pure functions.
import { describe, expect, test } from 'vitest'
import { formatCell, groupRows, sumOf } from '../src/runtime/table'

describe('grouping rows', () => {
  const ROWS = [
    { item: 'Notebook A5', category: 'Stationery' },
    { item: 'Salted Crisps', category: 'Snacks' },
    { item: 'Gel Pen', category: 'Stationery' },
    { item: 'Gift Wrap', category: null },
  ]

  test('there is one group per value, in the order the values first appear', () => {
    expect(groupRows(ROWS, 'category').map((group) => group.name)).toEqual(['Stationery', 'Snacks', 'None'])
  })

  test('a group holds its rows with each one\'s place among all the rows', () => {
    expect(groupRows(ROWS, 'category')[0]!.rows).toEqual([{ row: ROWS[0], index: 0 }, { row: ROWS[2], index: 2 }])
  })

  test('rows with no value, blank or missing, are one group that can be opened by its name', () => {
    expect(groupRows([{ category: null }, { category: '' }, {}], 'category').map((group) => [group.key, group.name, group.rows.length])).toEqual([['None', 'None', 3]])
  })
})

describe('a group\'s total', () => {
  test('adds the numbers up', () => {
    expect(sumOf([820, 690])).toBe(1510)
  })

  test('counts a number written as text, and skips what is no number', () => {
    expect(sumOf(['820', null, 'many', 690])).toBe(1510)
  })

  test('is nothing when there is no number to add', () => {
    expect(sumOf([null, undefined])).toBeNull()
  })
})

describe('a cell\'s text', () => {
  test.each([
    [16400, 'number', '16,400'],
    [16400, 'currency', '₹16,400.00'],
    ['2026-12-01', 'date', '01-Dec-2026'],
    [16400, 'text', '16400'],
    [16400, undefined, '16400'],
    [null, undefined, ''],
    [null, 'number', '—'],
  ] as const)('%j as %s reads %s', (value, format, text) => {
    expect(formatCell(value, format)).toBe(text)
  })
})
