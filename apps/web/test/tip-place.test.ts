// #1251: a shortcut tip takes the highest spot in the page that covers no
// control, as near the middle as it can. Candidate spots come from the real
// controls' edges (below each, beside each), so it does not depend on fonts
// or on how a page lays out its header (CI smoke, 17-Nov-2026).
import { describe, expect, test } from 'vitest'
import { placeTip, type Box } from '../src/lib/tip-place'

const area = { left: 16, right: 1424, top: 60, bottom: 800 }
const size = { width: 400, height: 40 }
const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height })
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const covers = (at: { left: number; top: number }, controls: Box[]) => controls.some((c) => overlaps(box(at.left, at.top, size.width, size.height), c))

describe('placeTip', () => {
  test('with nothing in the way it sits centred at the top', () => {
    expect(placeTip(size, [], area)).toEqual({ left: 520, top: 60 })
  })

  test('it moves aside rather than cover a header button, staying at the top', () => {
    const buttons = [box(560, 70, 140, 34), box(708, 70, 110, 34)]
    const at = placeTip(size, buttons, area)!
    expect(covers(at, buttons)).toBe(false)
    expect(at.top).toBe(60)
  })

  test('it fits into a gap between controls when there is room beside them', () => {
    // The title row of a list: view buttons at the left, More and New at the right.
    const row = [box(16, 60, 520, 40), box(966, 60, 458, 40)]
    const at = placeTip(size, row, area)!
    expect(at.top).toBe(60)
    expect(covers(at, row)).toBe(false)
  })

  test('when a whole band is taken it goes just below it, not further', () => {
    const band = [box(0, 62, 1440, 30)]
    expect(placeTip(size, band, area)).toEqual({ left: 520, top: 100 })
  })

  test('controls lower down are avoided too, wherever the tip ends up', () => {
    // A header band, then table rows with a link at their left.
    const controls = [box(0, 60, 1440, 120), ...[200, 240, 280].map((y) => box(60, y, 600, 24))]
    const at = placeTip(size, controls, area)!
    expect(at.top).toBe(188)
    expect(covers(at, controls)).toBe(false)
  })

  test('with no room anywhere it says so, and the caller tries another shape', () => {
    expect(placeTip(size, [box(0, 50, 1440, 800)], area)).toBeNull()
    expect(placeTip({ width: 600, height: 40 }, [], { left: 16, right: 400, top: 60, bottom: 800 })).toBeNull()
  })
})
