// #1282 Why mode: the one versioned shape an app's explanation must have before
// the Map draws it, and the words its toggle may carry.
import { describe, expect, test } from 'vitest'
import { WHY_DEFAULT_LABEL, WHY_LABEL, WHY_LIMITS, whyAnswerSchema } from '../src/why'

const box = (id: string) => ({ id, name: id.toUpperCase() })
const answer = (columns: string[][], edges: [string, string][] = []) =>
  ({ version: 1, columns: columns.map((ids, i) => ({ heading: `Column ${i + 1}`, boxes: ids.map(box) })), edges })

describe('a Why answer', () => {
  test('columns of boxes joined left to right is one the Map can draw', () => {
    expect(whyAnswerSchema.safeParse(answer([['a'], ['b', 'c']], [['a', 'b'], ['a', 'c']])).success).toBe(true)
  })

  test.for([
    ['two boxes with one id', answer([['a', 'a']])],
    ['an edge to a box that is not there', answer([['a']], [['a', 'z']])],
    ['an edge within one column', answer([['a', 'b']], [['a', 'b']])],
    ['an edge leading left', answer([['a'], ['b']], [['b', 'a']])],
    ['a version the platform does not know', { ...answer([['a']]), version: 2 }],
    ['a field the shape does not have', { ...answer([['a']]), html: '<b>' }],
    ['a box with both a detail and detail parts', { version: 1, edges: [], columns: [{ heading: 'A', boxes: [{ id: 'a', name: 'A', detail: 'x', detailParts: [{ name: 'Lakeside' }] }] }] }],
  ] as const)('%s is refused', ([, value]) => {
    expect(whyAnswerSchema.safeParse(value).success).toBe(false)
  })

  test(`more than ${WHY_LIMITS.boxes} boxes is refused: past that a map stops being readable`, () => {
    const columns = Array.from({ length: WHY_LIMITS.columns }, (_, c) => Array.from({ length: 7 }, (_, b) => `c${c}b${b}`))
    expect(columns.flat().length).toBeGreaterThan(WHY_LIMITS.boxes)
    expect(whyAnswerSchema.safeParse(answer(columns)).success).toBe(false)
  })
})

describe("a Why toggle's words", () => {
  test.for([WHY_DEFAULT_LABEL, 'Why: Her Access', 'Why: Dash · Reports', "Why: Who's In 2026"])('%j reads in Title Case', (label) => {
    expect(WHY_LABEL.test(label)).toBe(true)
  })

  test.for(['why: access', 'Why access', 'Why: her Access', 'Why: '])('%j does not', (label) => {
    expect(WHY_LABEL.test(label)).toBe(false)
  })
})
