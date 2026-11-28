// The category head's own figures: the behind-AOP counts, the store map's cells, the ranked lists, the scope path.
import { describe, expect, it } from 'vitest'
import { madeUpChain } from '../shared/madeUpChain'
import { LEVEL } from '../shared/levels'
import type { Line } from '../shared/model'
import { behindCounts, cellLines, commonPath, matrix, matrixRow, metricOf, rankings, storesBySize, tintOf } from './heads'

const base = madeUpChain().lines[0]
let n = 0
const line = (store: string, category: string, name: string, fc: number, aop: number, ly = fc, r31 = fc): Line =>
  ({ ...base, rowId: `r${n++}`, store, storeName: store, category, name, fc, aop, ly, r31 })

const lines = [
  line('AAA', 'Saree', 'Silk', 800_000, 1_000_000, 600_000),   // 20% behind
  line('AAA', 'Saree', 'Cotton', 95_000, 100_000, 95_000),     // 5% behind: close, not behind
  line('AAA', 'Kurti', 'Long', 300_000, 250_000, 400_000),     // above
  line('BBB', 'Saree', 'Silk', 200_000, 400_000, 210_000),     // 50% behind
  line('BBB', 'Kurti', 'Long', 100_000, 0, 70_000),            // no plan
]

describe('more than 10% behind AOP', () => {
  it('counts stores, categories and subcategories planned at ₹1 L or more', () => {
    const c = behindCounts(lines)
    // AAA 1,195,000 vs 1,350,000 = 88.5%; BBB 300,000 vs 400,000
    expect(c.stores).toEqual({ behind: 2, of: 2 })
    // Saree 1,095,000 vs 1,500,000; Kurti 400,000 vs 250,000
    expect(c.categories).toEqual({ behind: 1, of: 2 })
    // planned at ₹1 L or more: AAA Silk, AAA Cotton, AAA Long, BBB Silk; behind: the two Silks
    expect(c.subcategories).toEqual({ behind: 2, of: 4 })
  })
})

describe('the store map', () => {
  it('measures against AOP, last year or last month, or the value, and has nothing to compare without a reference', () => {
    expect(metricOf('aop', { fc: 80, aop: 100, ly: 0, r31: 50 })).toBeCloseTo(-0.2)
    expect(metricOf('ly', { fc: 80, aop: 100, ly: 0, r31: 50 })).toBeNull()
    expect(metricOf('lm', { fc: 80, aop: 100, ly: 0, r31: 50 })).toBeCloseTo(0.6)
    expect(metricOf('v', { fc: 80, aop: 100, ly: 0, r31: 50 })).toBe(80)
  })
  it('tints below and above, darker the further, full at 40%, none when nearly level', () => {
    expect(tintOf('aop', -0.2, 0)).toEqual({ tone: 'below', strength: 0.5 })
    expect(tintOf('aop', 0.8, 0)).toEqual({ tone: 'above', strength: 1 })
    expect(tintOf('aop', 0.01, 0)).toBeNull()
    expect(tintOf('aop', null, 0)).toBeNull()
    expect(tintOf('v', 50, 200)).toEqual({ tone: 'size', strength: 0.25 })
  })
  it('runs the stores biggest first, leaves a store without the category empty, and sums the row', () => {
    const stores = storesBySize(lines).map(s => s.code)
    expect(stores).toEqual(['AAA', 'BBB'])
    const row = matrixRow(lines.filter(l => l.category === 'Saree'), 'Saree', 'Saree', [...stores, 'CCC'], 'aop')
    expect(row.cells.map(c => c.lines.length)).toEqual([2, 1, 0])
    expect(row.cells[2].item).toBeNull()
    expect(row.cells[1].value).toBeCloseTo(-0.5)
    expect(row.all.item!.fc).toBe(1_095_000)
  })
  it('orders categories by the sort and opens a category into its subcategories', () => {
    const rows = matrix(lines, ['AAA', 'BBB'], 'aop', new Set(['Saree']), (a, b) => (a.fc - a.aop) - (b.fc - b.aop))
    expect(rows.map(r => r.row.key)).toEqual(['Saree', 'Kurti'])
    expect(rows[0].subs.map(s => s.key)).toEqual(['Saree › Silk', 'Saree › Cotton'])
    expect(rows[1].subs).toEqual([])
  })
  it('finds the subcategories behind a clicked cell', () => {
    expect(cellLines(lines, 'Saree', 'AAA').map(l => l.name)).toEqual(['Silk', 'Cotton'])
    expect(cellLines(lines, 'Saree › Silk', null).map(l => l.store)).toEqual(['AAA', 'BBB'])
    expect(cellLines(lines, '*', 'BBB')).toHaveLength(2)
  })
})

describe('furthest from plan', () => {
  it('ranks the biggest shortfalls to AOP (planned rows only) and the biggest changes on last year', () => {
    const r = rankings(lines, 'line', 3)
    expect(r.behindAop.map(x => `${x.store} ${x.name}`)).toEqual(['AAA Silk', 'BBB Silk', 'AAA Cotton'])
    expect(r.fromLastYear.map(x => `${x.store} ${x.name}`)).toEqual(['AAA Silk', 'AAA Long', 'BBB Long'])
  })
  it('ranks whole categories at a store', () => {
    const r = rankings(lines, 'cat')
    expect(r.behindAop[0]).toMatchObject({ key: 'AAA|Saree', line: null })
    expect(r.behindAop[0].item.fc).toBe(895_000)
    expect(r.behindAop.map(x => x.key)).not.toContain('BBB|Kurti')
  })
})

describe('opening the tree at a scope', () => {
  it('opens the nodes every line in scope shares', () => {
    expect(commonPath(lines.filter(l => l.store === 'AAA'), [LEVEL.store, LEVEL.category])).toEqual(['AAA'])
    expect(commonPath(lines.filter(l => l.name === 'Silk'), [LEVEL.category, LEVEL.subcategory])).toEqual(['Saree', 'Saree › Silk'])
    expect(commonPath(lines, [LEVEL.category, LEVEL.store])).toEqual([])
  })
})
