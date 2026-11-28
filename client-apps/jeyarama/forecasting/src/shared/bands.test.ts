import { describe, expect, it } from 'vitest'
import fixture from '../../fixtures/team-leader-december.json'
import { linesFrom, monthOfRun, type CopiedRows } from './model'
import { NO_BAND, bandsOf, coverOf, daysLeft, isShort, notSelling, shortBands, stockAsOf, type Band, type BandRows, type StockBandRow } from './bands'

const lines = linesFrom({ lines: fixture.forecast_line_month, sales: fixture.sales_reference, plans: fixture.annual_plan_line, others: fixture.other_model_line,
  bands: { mix: fixture.price_band_mix, stock: fixture.stock_band, items: fixture.price_band_top_item } } as unknown as CopiedRows, 'LKS')
const december = monthOfRun('2026-12-01')
const band = (over: Partial<Band>): Band => ({ name: '₹500–600', order: 1, fc: 0, fq: 0, share: 0, stock: 0, sold: 0, n50: null, n70: null, items: [], ...over })

describe('By Price Band (#1419, 28-Nov-2026)', () => {
  it("splits each subcategory's forecast by its bands' share of the last 28 days, cheapest band first", () => {
    for (const l of lines) {
      const sold = l.bands!.filter(b => b.share > 0)
      expect(Math.abs(sold.reduce((t, b) => t + b.fc, 0) - l.fc)).toBeLessThanOrEqual(sold.length)
      expect(l.bands!.map(b => b.order)).toEqual([...l.bands!.map(b => b.order)].sort((a, b) => a - b))
    }
  })

  it('splits pieces by the piece share and value by the value share', () => {
    const rows: BandRows = {
      mix: [{ store_code: 'S', subcategory_name: 'X', price_band: 'cheap', price_band_order: 1, sales_value_before_tax: 100, sales_qty: 30, items_sold: 3, value_share: 0.25, qty_share: 0.6, items_to_50_pct: 1, items_to_70_pct: 2 }],
      stock: [], items: [],
    }
    expect(bandsOf(rows, 'S', 'X', 1000, 50)[0]).toMatchObject({ fc: 250, fq: 30 })
  })

  it('lists a band that holds stock but sold nothing, with no forecast, as not selling', () => {
    const dead = lines.flatMap(l => l.bands!).filter(b => b.name === 'Never sold (90 d)')
    expect(dead.length).toBeGreaterThan(0)
    for (const b of dead) { expect(b.fq).toBe(0); expect(notSelling(b)).toBe(true); expect(coverOf(b, 31)).toBeNull() }
  })

  it('counts the days from the stock count to the end of the month: 27-Nov to 31-Dec is 34', () => {
    expect(daysLeft('2026-11-27', december)).toBe(34)
    expect(stockAsOf(fixture.stock_band as unknown as StockBandRow[])).toBe('2026-11-27')
  })

  it("calls a band short when its stock lasts fewer days, at the month's forecast pace, than the month has left", () => {
    // 62 pieces forecast for 31 days is 2 a day: 60 in stock lasts 30 days
    expect(coverOf(band({ fq: 62, stock: 60 }), 31)).toBe(30)
    expect(isShort(band({ fq: 62, stock: 60 }), 31, 34)).toBe(true)
    expect(isShort(band({ fq: 62, stock: 70 }), 31, 34)).toBe(false)
  })

  it('lists the short bands biggest shortfall first, never the No band bucket', () => {
    const l = (name: string, bands: Band[]) => ({ name, bands })
    const short = shortBands([l('A', [band({ name: 'a', fq: 100, stock: 20 }), band({ name: NO_BAND, fq: 500, stock: 0 })]), l('B', [band({ name: 'b', fq: 300, stock: 50 })])], 31, 34)
    expect(short.map(s => `${s.line.name} · ${s.band.name}`)).toEqual(['B · b', 'A · a'])
  })

  it("gives a band's top items in rank order", () => {
    const top = lines[0].bands![1].items
    expect(top).toHaveLength(5)
    expect(top.map(i => i.value)).toEqual([...top.map(i => i.value)].sort((a, b) => b - a))
  })
})
