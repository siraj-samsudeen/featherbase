// The look kit's script (#1408) writes amounts, counts and dates in a prototype
// as the components write them in the app. It restates format.ts in plain
// JavaScript, because a prototype opened from disk has no build step; this
// test runs both on the same values, so the two cannot drift apart.
import { describe, expect, it } from 'vitest'
import { fmtCount, fmtDate, fmtExact, fmtINR, fmtPct } from '@featherbase/shop-floor/format'
// A plain browser script: loading it sets `fbLook` on the global object.
import '../../../packages/shop-floor/look-kit/featherbase-look.js'

interface KitFormats {
  inr(x: number | null | undefined, options?: { signed?: boolean }): string
  exact(x: number | null | undefined): string
  count(x: number | null | undefined, decimals?: number): string
  pct(x: number | null | undefined): string
  date(iso: string | null | undefined): string
  donut(shares: number[]): string
}
const fbLook = (globalThis as unknown as { fbLook: KitFormats }).fbLook

const AMOUNTS = [0, 1, -1, 850, 999.4, 1000, 12345, 99999.6, 100000, 248000, -41000, 9950000, 17400000, 1234567890, 12345678901, 0.004, null, undefined, NaN, Infinity]

describe('the look kit’s formats are the components’ formats', () => {
  it.each(AMOUNTS)('rupees, counts and percentages of %s', (x) => {
    expect(fbLook.inr(x)).toBe(fmtINR(x))
    expect(fbLook.inr(x, { signed: true })).toBe(fmtINR(x, { signed: true }))
    expect(fbLook.exact(x)).toBe(fmtExact(x))
    expect(fbLook.count(x)).toBe(fmtCount(x))
    expect(fbLook.count(x, 2)).toBe(fmtCount(x, 2))
    expect(fbLook.pct(x)).toBe(fmtPct(x))
  })

  it.each(['2026-12-01', '2026-01-31', '2026-13-01', '', null, undefined])('the day %s', (day) => {
    expect(fbLook.date(day)).toBe(fmtDate(day))
  })

  it('reads an amount the way the house rules ask', () => {
    expect(fbLook.inr(12345)).toBe('₹12,345')
    expect(fbLook.inr(248000)).toBe('₹2.48 L')
    expect(fbLook.exact(1234567.5)).toBe('₹12,34,567.50')
    expect(fbLook.date('2026-12-01')).toBe('01-Dec-2026')
  })
})
