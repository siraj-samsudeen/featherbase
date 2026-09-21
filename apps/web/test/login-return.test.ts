import { describe, expect, test } from 'vitest'
import { safeLoginNext } from '../src/pages/Login'

describe('login return path', () => {
  test('accepts a local application path including its query and fragment', () => {
    expect(safeLoginNext('/tasker/?view=work#task=TASK-00001'))
      .toBe('/tasker/?view=work#task=TASK-00001')
  })

  test.each([
    'https://attacker.example/tasker/',
    '//attacker.example/tasker/',
    '/\\attacker.example/tasker/',
  ])('refuses an external or ambiguous return path: %s', (next) => {
    expect(safeLoginNext(next)).toBeUndefined()
  })
})
