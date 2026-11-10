import { describe, expect, test } from 'vitest'
import { errorMessage } from '../src/errors'

describe('what a caught value says', () => {
  test("an Error says its message", () => {
    expect(errorMessage(new Error('the disk is full'))).toBe('the disk is full')
  })

  test('a thrown value that is not an Error says its text', () => {
    expect(errorMessage('the disk is full')).toBe('the disk is full')
  })
})
