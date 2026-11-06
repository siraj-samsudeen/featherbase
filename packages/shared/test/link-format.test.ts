import { expect, it } from 'vitest'
import { linkText, splitStandInTitle } from '../src/index'

it.each([
  ['name_code', 'Kurti Z (1517)'],
  ['code_name', '1517 (Kurti Z)'],
  ['name', 'Kurti Z'],
  ['code', '1517'],
  [null, 'Kurti Z (1517)'],
  [undefined, 'Kurti Z (1517)'],
] as const)('a link in format %s reads %s', (format, text) => {
  expect(linkText(format, 'Kurti Z', '1517')).toBe(text)
})

it.each(['name_code', 'code_name', 'name', 'code'] as const)('a row with no separate code reads as its name in %s', (format) => {
  expect(linkText(format, 'Kurti Z')).toBe('Kurti Z')
})

it('a stand-in title splits into its name and code', () => {
  expect(splitStandInTitle('Kurti Z · 1517')).toEqual({ name: 'Kurti Z', code: '1517' })
})

it('a title with no separator, or whose last part has letters, is one name', () => {
  expect(splitStandInTitle('Kurti Z')).toBeNull()
  expect(splitStandInTitle('North · South')).toBeNull()
})
