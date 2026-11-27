// The managers' shared pieces: the made-up chain, folding small subcategories, changes, levels and search/scope.
import { describe, expect, it } from 'vitest'
import { madeUpChain, SMALL_UNDER, STORES } from './madeUpChain'
import { foldSmall, isFolded } from './model'
import { changeWords, daysBetween, monthAfter } from './review'
import { MERCHANDISE, STORE_LAYOUT, LEVEL, pathTo, treeOf } from './levels'
import { buildIndex, choose, inScope, nearest, results } from './scope'

const { lines, sections, proposals } = madeUpChain()
const lks = lines.filter(l => l.store === 'LKS')

describe('the made-up chain', () => {
  it('has every store, with its region, floors and sections, and parts that add up', () => {
    expect(new Set(lines.map(l => l.store))).toEqual(new Set(STORES.map(s => s.code)))
    expect(new Set(lines.map(l => l.region))).toEqual(new Set(['Kerala', 'Tamil Nadu']))
    for (const l of lines) expect(Math.abs(l.fromRecent + l.lift + l.lyg + l.adj - l.fc)).toBeLessThanOrEqual(2)
    for (const l of lks) expect(sections.some(s => s.store === 'LKS' && s.section === l.section && s.floor === l.floor)).toBe(true)
  })
  it('has six proposals waiting at Lakeside, each with its month total after the change', () => {
    const mine = proposals.filter(p => p.line.includes(':LKS:'))
    expect(mine).toHaveLength(6)
    for (const p of mine) expect(p.proposed).toBe(monthAfter(p.forecast, 31, p.change))
    expect(mine.some(p => p.change.scope === 'day' && p.change.batch)).toBe(true)
  })
})

describe('RB: smaller subcategories folded per store × category', () => {
  const folded = foldSmall(lines, SMALL_UNDER)
  it('keeps the total and folds only rows under the limit', () => {
    expect(folded.reduce((t, l) => t + l.fc, 0)).toBe(lines.reduce((t, l) => t + l.fc, 0))
    const f = folded.filter(isFolded)
    expect(f.length).toBeGreaterThan(0)
    for (const r of f) expect(r.name).toBe('Smaller subcategories')
    for (const l of folded.filter(l => !isFolded(l))) if (l.fc < SMALL_UNDER) expect(folded.filter(x => x.store === l.store && x.category === l.category && isFolded(x))).toHaveLength(0)
  })
})

describe('changes: month ₹, month ± %, days', () => {
  it('works out the month after each kind', () => {
    expect(monthAfter(310_000, 31, { scope: 'month', method: 'set_value', value: 250_000 })).toBe(250_000)
    expect(monthAfter(310_000, 31, { scope: 'month', method: 'percent', percent: -10 })).toBe(279_000)
    // 3 of 31 days at ₹10,000 each, moved +20%: +₹6,000
    expect(monthAfter(310_000, 31, { scope: 'day', method: 'percent', percent: 20, days: daysBetween('2026-12-24', '2026-12-26') })).toBe(316_000)
    // one day set to ₹2,000 in place of ₹10,000
    expect(monthAfter(310_000, 31, { scope: 'day', method: 'set_value', value: 2000, days: ['2026-12-31'] })).toBe(302_000)
  })
  it('says the change in words', () => {
    const d = (s: string) => s
    expect(changeWords({ scope: 'month', method: 'percent', percent: -10 }, String, d)).toBe('Month −10%')
    expect(changeWords({ scope: 'day', method: 'percent', percent: 20, days: daysBetween('2026-12-24', '2026-12-26') }, String, d)).toBe('3 days (2026-12-24 to 2026-12-26) +20%')
  })
})

describe('levels', () => {
  it('Store layout puts floors in building order; Merchandise goes division › subdivision › category', () => {
    expect(treeOf(lks, STORE_LAYOUT).map(n => n.label)).toEqual(['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor'])
    const merch = treeOf(lks, MERCHANDISE)
    expect(merch.map(n => n.label).sort()).toEqual(['Fashion', 'Home'])
    expect(merch[0].children[0].children[0].level).toBe('Category')
  })
  it('opens the path to a subcategory', () => {
    const l = lks[0]
    expect(pathTo(l, [LEVEL.region, LEVEL.store])).toEqual([l.region, `${l.region} › LKS`])
  })
})

describe('search and scope', () => {
  const index = buildIndex(lines)
  it('finds every kind a word names, grouped in order', () => {
    const kinds = results(index, 'girls').map(([k]) => k)
    expect(kinds).toEqual(['section', 'subdivision', 'category', 'subcategory'])
    expect(results(index, 'lks')[0][1][0]).toMatchObject({ kind: 'store', label: 'LKS', sub: 'Lakeside' })
  })
  it('stacks a store and a division; a second store replaces the first', () => {
    const store = index.find(e => e.kind === 'store' && e.key === 'LKS')!
    const division = index.find(e => e.kind === 'division' && e.key === 'Home')!
    let scope = choose(choose([], store), division)
    expect(scope.map(s => s.kind)).toEqual(['store', 'division'])
    expect(lines.filter(inScope(scope)).every(l => l.store === 'LKS' && l.division === 'Home')).toBe(true)
    scope = choose(scope, index.find(e => e.kind === 'store' && e.key === 'MRN')!)
    expect(scope.map(s => s.key)).toEqual(['Home', 'MRN'])
  })
  it('offers the nearest names when nothing matches', () => {
    expect(results(index, 'bedshet')).toEqual([])
    expect(nearest(index, 'bedshet').map(e => e.label)).toContain('Bedsheet')
  })
})
