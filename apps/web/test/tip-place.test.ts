// #1251: a shortcut tip lands below the top bar, as near the middle as it can,
// and never on a control (a header button, the control just used).
import { describe, expect, test } from 'vitest'
import { placeTip, type Box } from '../src/lib/tip-place'

const area = { left: 16, right: 1424, top: 60 }
const size = { width: 400, height: 40 }
const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height })
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

describe('placeTip', () => {
  test('with nothing in the way it sits centred just below the bar', () => {
    expect(placeTip(size, [], area)).toEqual({ left: 520, top: 60 })
  })

  test('it moves aside rather than cover a header button', () => {
    const buttons = [box(560, 70, 140, 34), box(708, 70, 110, 34)]
    const at = placeTip(size, buttons, area)
    const tip = box(at.left, at.top, size.width, size.height)
    expect(buttons.some((b) => overlaps(tip, b))).toBe(false)
    expect(at.top).toBe(60)
  })

  test('when a whole row is taken it drops to the next', () => {
    const row = [box(0, 62, 1440, 30)]
    const at = placeTip(size, row, area)
    expect(at.top).toBeGreaterThanOrEqual(92)
    expect(overlaps(box(at.left, at.top, size.width, size.height), row[0])).toBe(false)
  })

  test('a narrow window still gets the tip, at the left edge', () => {
    expect(placeTip({ width: 600, height: 40 }, [], { left: 16, right: 400, top: 60 })).toEqual({ left: 16, top: 60 })
  })
})
