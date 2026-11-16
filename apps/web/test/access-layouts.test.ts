import { expect, test } from 'vitest'
import { readChangePhrase } from '../src/pages/AccessLayouts'

// #1224 (Codex round 8): reading and changing are counted on their own; a
// change-only grant is never said to read.
const t = (read: boolean, change: boolean) => ({ read, change })

test.each([
  [[t(true, false), t(true, false)], 'read 2 tables'],
  [[t(true, true), t(true, true)], 'read and change 2 tables'],
  [Array(5).fill(t(false, true)), 'change 5 tables'],
  [[t(true, true), t(true, false), t(true, false)], 'read 3 tables and change 1 of them'],
  [[t(true, false), t(true, false), t(false, true)], 'read 2 tables and change 1 table'],
])('%j reads "%s"', (tables, phrase) => {
  expect(readChangePhrase(tables)).toBe(phrase)
})

test('a place goes before "of them"', () => {
  expect(readChangePhrase([t(true, true), t(true, false)], ' here')).toBe('read 2 tables here and change 1 of them')
})
