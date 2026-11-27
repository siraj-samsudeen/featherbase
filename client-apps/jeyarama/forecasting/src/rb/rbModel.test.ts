// The RB review's own logic: levels, breadcrumb, opening the tree to a scope, progress per store, the answer.
import { describe, expect, it } from 'vitest'
import { madeUpChain, SMALL_UNDER } from '../shared/madeUpChain'
import { combine, foldSmall, inr } from '../shared/model'
import { answerFacts, crumbHint, crumbSteps, focusScope, gapNodes, idsOf, linesAt, rbLevels, storeProgress } from './rbModel'

const { lines: raw, sections } = madeUpChain()
const lines = foldSmall(raw, SMALL_UNDER)
const byCategory = rbLevels('category', sections), bySection = rbLevels('section', sections)

describe('levels', () => {
  it('goes Region › Store › Division › Category, or Region › Store › Section with the Team Leader under it', () => {
    expect(byCategory.map(l => l.name)).toEqual(['Store', 'Division', 'Category'])
    expect(bySection.map(l => l.name)).toEqual(['Store', 'Section'])
    const l = lines.find(x => x.store === 'LKS')!
    const node = { lines: [l], label: l.section } as Parameters<NonNullable<typeof bySection[1]['subLabel']>>[0]
    expect(bySection[1].subLabel!(node)).toBe(sections.find(s => s.store === 'LKS' && s.section === l.section)!.teamLeader)
  })
})

describe('the breadcrumb', () => {
  it('names each step, the store with its name, and the last is where you are', () => {
    const steps = crumbSteps(['LKS', 'Fashion'], c => (c === 'LKS' ? 'Lakeside' : undefined), 'Kerala')
    expect(steps.map(s => s.label)).toEqual(['Kerala', 'LKS Lakeside', 'Fashion'])
    expect(steps.map(s => s.at)).toEqual([0, 1, 2])
    expect(steps.filter(s => s.current).map(s => s.label)).toEqual(['Fashion'])
  })
  it('says what a click does next', () => {
    expect(crumbHint([], byCategory)).toBe('click a row to go down to store')
    expect(crumbHint(['LKS'], byCategory)).toBe('click a row to go down to division')
    expect(crumbHint(['LKS', 'Fashion', 'Women'], byCategory)).toBe('click a subcategory for how Feather Forecast built it')
  })
  it('keeps the lines under it', () => {
    const at = linesAt(lines, byCategory, ['LKS'])
    expect(at.length).toBeGreaterThan(0)
    expect(at.every(l => l.store === 'LKS')).toBe(true)
    expect(idsOf(['LKS', 'Fashion'])).toEqual(['LKS', 'LKS › Fashion'])
  })
})

describe('opening the tree to a scope', () => {
  it('opens every level the scoped lines share, and every path when 40 or fewer remain', () => {
    const lks = lines.filter(l => l.store === 'LKS')
    const f = focusScope(lks, byCategory, true)
    expect(f.crumb).toEqual(['LKS'])
    expect(f.open.has('LKS')).toBe(true)
    if (lks.length > 40) expect(f.open.size).toBe(1)
    const one = lks.filter(l => l.category === lks[0].category)
    expect(focusScope(one, byCategory, true).open.has(`LKS › ${one[0].division} › ${one[0].category}`)).toBe(true)
  })
  it('opens nothing without a scope', () => {
    const f = focusScope(lines, byCategory, false)
    expect([...f.open]).toEqual([])
    expect(f.crumb).toEqual([])
  })
})

describe('progress and the answer', () => {
  const progress = storeProgress(lines, ls => ls.filter(l => l.store === 'LKS').length ? 6 : 0)
  it('has every store once, the most waiting first, counting folded subcategories', () => {
    expect(progress).toHaveLength(8)
    expect(progress[0].store).toBe('LKS')
    expect(progress.reduce((t, x) => t + x.lines, 0)).toBe(raw.length)
    for (const x of progress) expect(x.answered).toBeGreaterThanOrEqual(25)
  })
  it('says where the gap to AOP is', () => {
    const f = answerFacts(lines, 'December', progress, 3)
    const T = combine(lines, -1), gap = T.fc - T.aop
    expect(f.headline).toContain(`December is forecast at ${inr(T.fc)}: ${inr(Math.abs(gap))}`)
    expect(f.regions.map(r => r.name).sort()).toEqual(['Kerala', 'Tamil Nadu'])
    expect(f.stores.top).toHaveLength(5)
    const stores = gapNodes(lines, l => l.store)
    expect(f.stores.top[0].store).toBe(stores[0].name)
    expect(stores[0].fc - stores[0].aop).toBeLessThanOrEqual(stores[1].fc - stores[1].aop)
    expect(f.waiting).toBe(6)
    expect(f.questions).toBe(3)
  })
})
