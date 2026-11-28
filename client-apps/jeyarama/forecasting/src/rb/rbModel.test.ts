// The RB review's own logic: levels, breadcrumb, opening the tree to a scope, progress per store, the answer.
import { describe, expect, it } from 'vitest'
import { madeUpChain, SMALL_UNDER } from '../shared/madeUpChain'
import { foldSmall } from '../shared/model'
import { crumbHint, crumbSteps, focusScope, idsOf, linesAt, rbLevels, storeProgress } from './rbModel'

const { lines: raw, sections } = madeUpChain()
const lines = foldSmall(raw, SMALL_UNDER)
const byCategory = rbLevels('category', sections), bySection = rbLevels('section', sections)

describe('levels', () => {
  it('goes Store › Division › Subdivision › Category, or Store › Section with the Team Leader under it', () => {
    expect(byCategory.map(l => l.name)).toEqual(['Store', 'Division', 'Subdivision', 'Category'])
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
    expect(crumbHint(['LKS', 'Fashion', 'Women', 'Saree'], byCategory)).toBe('click a subcategory for how Feather Forecast built it')
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
    expect(focusScope(one, byCategory, true).open.has(`LKS › ${one[0].division} › ${one[0].subdivision} › ${one[0].category}`)).toBe(true)
  })
  it('opens nothing without a scope', () => {
    const f = focusScope(lines, byCategory, false)
    expect([...f.open]).toEqual([])
    expect(f.crumb).toEqual([])
  })
})

describe('progress', () => {
  const progress = storeProgress(lines, ls => ls.filter(l => l.store === 'LKS').length ? 6 : 0)
  it('has every store once, the most waiting first, counting folded subcategories', () => {
    expect(progress).toHaveLength(8)
    expect(progress[0].store).toBe('LKS')
    expect(progress.reduce((t, x) => t + x.lines, 0)).toBe(raw.length)
    for (const x of progress) expect(x.answered).toBeGreaterThanOrEqual(25)
  })
})
