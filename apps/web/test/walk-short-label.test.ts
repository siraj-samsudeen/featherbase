// #1282 (UI owner): Recently Opened names a long walk by where it starts and where it ends.
import { describe, expect, test } from 'vitest'
import { walkShortLabel } from '../src/lib/step-labels'

describe("a walk's short name", () => {
  test('a walk of three or more steps keeps its first and last, with … between', () => {
    expect(walkShortLabel('Lakeside › Bags & Silk › Devi Department-Manager')).toBe('Lakeside › … › Devi Department-Manager')
    expect(walkShortLabel('Lakeside › Bags & Silk › Lakeside › Devi')).toBe('Lakeside › … › Devi')
  })

  test('a walk of one or two steps reads whole', () => {
    expect(walkShortLabel('Site Master › Region: Kerala')).toBe('Site Master › Region: Kerala')
    expect(walkShortLabel('Lakeside')).toBe('Lakeside')
  })
})
