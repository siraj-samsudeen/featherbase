import { describe, expect, it } from 'vitest'
import { explain, shareText, sharesOf, weightText, weightUsed, weightsOf } from './explanation'
import type { Base } from './model'

const b = (code: Base['code'], own: number | null, adds: number, mw: number | null = null): Base => ({ code, own, w: null, mw, adds })

describe('the one explanation table (#1419, Siraj 28-Nov)', () => {
  const bases = [b('B3', 746670, 6690.4), b('B1', 1644639, 219131.2, 0.14), b('B6', 953083, 664501.4), b('B2', 1658119, 65300.3), b('B4', 744410, 57415.2), b('B5', 730867, 36704.4)]
  const e = explain(bases, 0, 3.2, 1049744)

  it('orders From last year (B1, B2), then From last month (B3–B6), then the steps after the blend', () => {
    expect(e.lastYear.map(r => r.code)).toEqual(['B1', 'B2'])
    expect(e.lastMonth.map(r => r.code)).toEqual(['B3', 'B4', 'B5', 'B6'])
    expect(e.after.map(r => r.kind)).toEqual(['price'])
  })

  it('makes the adds whole rupees that sum to Feather Forecast exactly, the remainder on the largest row', () => {
    const all = [...e.lastYear, ...e.lastMonth, ...e.after]
    expect(all.every(r => Number.isInteger(r.adds))).toBe(true)
    expect(all.reduce((t, r) => t + r.adds, 0)).toBe(1049744)
    expect(e.lastMonth.find(r => r.code === 'B6')!.adds).toBe(664501 + (1049744 - all.reduce((t, r) => t + Math.round(r.adds), 0) + 0))
  })

  it('gives signed shares that sum to exactly 100.0%', () => {
    expect(sharesOf([800, 300, -100], 1000)).toEqual([800, 300, -100])
    const s = sharesOf([1, 1, 1], 3)
    expect(s.reduce((t, x) => t + x, 0)).toBe(1000)
    expect([shareText(271), shareText(-165), shareText(0), shareText(1000)]).toEqual(['27.1%', '−16.5%', '0%', '100%'])
  })

  it("shows the weight used as adds ÷ own to two decimals, and the weights' total as about 100%", () => {
    const b1 = e.lastYear[0]
    expect(weightText(weightUsed(b1)!)).toBe('13.32%')
    expect(b1.fitted).toBe(0.14)
    expect(Math.round(weightsOf([...e.lastYear, ...e.lastMonth]) * 100)).toBe(101)
    expect(weightUsed({ kind: 'rebal', own: null, fitted: null, adds: 5, share: 0 })).toBeNull()
  })
})
