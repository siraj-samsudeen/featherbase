// Production bug, 20-Nov-2026: a count's card opened to the right of a chip near the side panel's edge and was cut
// off. The card now stays in the window: shifted left when it would run off the right, above its chip when there is
// no room below, and never wider than the window. Made-up sizes.
import { describe, expect, test } from 'vitest'
import { placeCard } from '@featherbase/shop-floor'

const desktop = { width: 1440, height: 900 }

describe("the peek card's place", () => {
  test('under its chip, aligned to its left edge, where there is room', () => {
    expect(placeCard({ left: 300, top: 160, bottom: 196 }, { height: 140 }, desktop)).toEqual({ left: 300, top: 202, width: 340, side: 'below' })
  })
  test("shifted left so it ends inside the window when the chip is near the right edge (the side panel's chips)", () => {
    expect(placeCard({ left: 1300, top: 400, bottom: 436 }, { height: 140 }, desktop)).toMatchObject({ left: 1440 - 340 - 8, side: 'below' })
  })
  test('above its chip when there is no room below', () => {
    expect(placeCard({ left: 300, top: 800, bottom: 836 }, { height: 140 }, desktop)).toEqual({ left: 300, top: 800 - 6 - 140, width: 340, side: 'above' })
  })
  test('below after all when there is no room above either', () => {
    expect(placeCard({ left: 300, top: 60, bottom: 96 }, { height: 860 }, desktop).side).toBe('below')
  })
  test('on a phone it fits the window, with room at both edges', () => {
    expect(placeCard({ left: 200, top: 300, bottom: 336 }, { height: 140 }, { width: 375, height: 812 })).toEqual({ left: 375 - 340 - 8, top: 342, width: 340, side: 'below' })
  })
  test('narrower than the card, it takes the window less its edges', () => {
    expect(placeCard({ left: 200, top: 300, bottom: 336 }, { height: 140 }, { width: 320, height: 640 })).toEqual({ left: 8, top: 342, width: 304, side: 'below' })
  })
})
