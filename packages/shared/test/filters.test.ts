import { expect, test } from 'vitest'
import { parseFilters } from '../src/index'

test.each([
  ['[null]', 0],
  ['{bad', 0],
  ['null', 0],
  ['{}', 0],
  ['[]', 0],
  ['[["a","="]]', 0],
  ['[["status","=","Overdue"]]', 1],
  ['[["status","=","Overdue"],null]', 0],
])('parseFilters(%s) keeps %i filter(s)', (raw, n) => {
  expect(parseFilters(raw)).toHaveLength(n)
})
test('absent input is no filters', () => expect(parseFilters(undefined)).toEqual([]))
