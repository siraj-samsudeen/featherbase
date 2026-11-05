// #742: the one Yes/No rule the server's filters and the web's quick filter box share.
import { expect, test } from 'vitest'
import { readYesNo } from '../src/index'

test.each([
  ['Yes', true],
  ['TRUE', true],
  ['1', true],
  [1, true],
  ['no', false],
  ['False', false],
  ['0', false],
  [0, false],
  [true, true],
  [false, false],
  [null, null],
  ['maybe', undefined],
  [2, undefined],
  [' yes ', undefined],
  [undefined, undefined],
  [{}, undefined],
])('readYesNo(%j) is %s', (value, meaning) => {
  expect(readYesNo(value)).toBe(meaning)
})
