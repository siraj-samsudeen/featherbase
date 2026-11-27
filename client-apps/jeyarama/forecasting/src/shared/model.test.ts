import { describe, expect, it } from 'vitest'
import fixture from '../../fixtures/team-leader-december.json'
import { byGapToLastYear, combine, day, groupsOf, inr, linesFrom, monthOfRun, pc, type CopiedRows, type Line } from './model'

const lines = linesFrom({ lines: fixture.forecast_line_month, sales: fixture.sales_reference, plans: fixture.annual_plan_line, others: fixture.other_model_line } as unknown as CopiedRows, 'LKS')
const line = (name: string, category: string, growth: number): Line => ({ ...lines[0], name, category, growth })

describe('the Team Leader model (#1419)', () => {
  it("builds each line's parts so they add up to Feather Forecast", () => {
    expect(lines).toHaveLength(10)
    for (const l of lines) expect(Math.abs(l.fromRecent + l.lift + l.lyg + l.adj - l.fc)).toBeLessThanOrEqual(2)
  })

  it('TL-20: groups the lines of one category whose growth went opposite ways, ×2 or more and ½ or less', () => {
    const [g] = groupsOf(lines)
    expect(groupsOf(lines)).toHaveLength(1)
    expect(g.members.map(m => m.name)).toEqual(['Girls Jean', 'Girls Jeggings', 'Girls Pant'])
    expect(g.name).toBe('Jean + Jeggings + Pant')
    expect(g.fc).toBe(g.members.reduce((t, m) => t + m.fc, 0))
  })

  it('TL-20: no group without both directions, and never across categories', () => {
    expect(groupsOf([line('A', 'X', 2.5), line('B', 'X', 0.9)])).toEqual([])
    expect(groupsOf([line('A', 'X', 2.5), line('B', 'Y', 0.3)])).toEqual([])
  })

  it('TL-16: sorts by the absolute rupee gap to last year', () => {
    const sorted = byGapToLastYear([...lines, combine(lines, 0)].slice(0, 4))
    for (let i = 1; i < sorted.length; i++) expect(Math.abs(sorted[i - 1].fc - sorted[i - 1].ly)).toBeGreaterThanOrEqual(Math.abs(sorted[i].fc - sorted[i].ly))
  })

  it('TL-19: rupees on the lakh ladder with a true minus, signed percentages, DD-Mon-YYYY dates', () => {
    expect(inr(998111)).toBe('₹9.98 L')
    expect(inr(61078)).toBe('₹61,078')
    expect(inr(-882)).toBe('−₹882')
    expect(pc(142, 100)).toBe('+42%')
    expect(pc(92, 100)).toBe('−8%')
    expect(pc(100, 100)).toBe('0%')
    expect(pc(1, 0)).toBe('—')
    expect(day('2026-11-26')).toBe('26-Nov-2026')
    expect(monthOfRun('2026-12-01')).toEqual({ name: 'December', year: 2026, label: 'December 2026', days: 31 })
  })
})

import { treeOf, visibleRows } from './levels'
describe('levels: a hierarchy over subcategories', () => {
  const tree = treeOf(lines, [{ name: 'Category', key: l => l.category }])
  it('sums each node from its subcategories, largest first', () => {
    expect(tree.map(n => n.label)).toEqual(['Girls Bottom', 'Girls Inner Wear', 'Girls Active Wear'])
    expect(tree[0].item.fc).toBe(lines.filter(l => l.category === 'Girls Bottom').reduce((t, l) => t + l.fc, 0))
  })
  it('shows an open node’s subcategories under it, and nothing under a closed one', () => {
    expect(visibleRows(tree, new Set())).toHaveLength(3)
    const rows = visibleRows(tree, new Set(['Girls Inner Wear']))
    expect(rows.map(r => r.node?.label ?? r.line?.name)).toEqual(['Girls Bottom', 'Girls Inner Wear', 'Girls Panties', 'Girls Active Wear'])
  })
})

import { baseWeight, signedShare } from './model'
describe('the build-up (#1419, corrected 27-Nov-2026)', () => {
  it('shows signed shares, so a negative adjustment takes its share away and the parts add to 100%', () => {
    expect(signedShare(-17375, 108166)).toBe('−16%')
    expect(signedShare(74000, 108166)).toBe('68%')
  })
  it("shows Feather Forecast's fitted month weight, not adds ÷ own, when the Run carries it", () => {
    expect(baseWeight({ code: 'B6', own: 100, w: 0.81, mw: 0.85, adds: 81 })).toBe(0.85)
    expect(baseWeight({ code: 'B6', own: 100, w: 0.81, mw: null, adds: 81 })).toBe(0.81)
    const first = fixture.forecast_line_month[0] as unknown as Record<string, number>
    expect(lines[0].bases.map(b => b.mw)).toEqual([1, 2, 3, 4, 5, 6].map(i => first[`weight_b${i}`]))
  })
})

describe('the steps after the blend, in two kinds (#1419, 27-Nov-2026)', () => {
  it("splits each line's adjustment into rebalancing and price and rounding, and the category's rebalancing nets to zero", () => {
    for (const l of lines) expect(l.rebal + l.price).toBe(l.adj)
    expect(lines.filter(l => l.category === 'Girls Bottom').reduce((t, l) => t + l.rebal, 0)).toBe(0)
  })
  it('counts the whole adjustment as rebalancing when a Run does not carry the two kinds', () => {
    const rows = fixture.forecast_line_month.map(r => ({ ...r, rebalanced_within_category: null, price_and_rounding: null }))
    const [l] = linesFrom({ lines: rows, sales: [], plans: [], others: [] } as unknown as CopiedRows, 'LKS')
    expect([l.rebal, l.price]).toEqual([l.adj, 0])
  })
  it('shows a share under half a percent as 0%, never −0%', () => {
    expect(signedShare(-1, 108166)).toBe('0%')
  })
})
