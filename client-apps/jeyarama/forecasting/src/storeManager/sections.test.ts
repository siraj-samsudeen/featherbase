// The Store Manager's sections: progress, the Section Board's order, and the tree opened for a scope.
import { describe, expect, it } from 'vitest'
import { madeUpChain } from '../shared/madeUpChain'
import { MERCHANDISE, STORE_LAYOUT, pathTo } from '../shared/levels'
import { answeredIn, boardOrder, focusOpen, fullyAnswered, meterWidth, sectionLine, sectionsOf } from './sections'

const { lines, sections } = madeUpChain()
const lks = lines.filter(l => l.store === 'LKS')
const info = sections.filter(s => s.store === 'LKS')

describe('section progress', () => {
  it('is steady, within 0..n, and null without a Team Leader', () => {
    expect(answeredIn('Sarees', 5, 'Asha')).toBe(answeredIn('Sarees', 5, 'Asha'))
    for (const s of info) { const d = answeredIn(s.section, 7, s.teamLeader)!; expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(7) }
    expect(answeredIn('Sarees', 5, undefined)).toBeNull()
  })
  it('sums each section of the store once, with its Team Leader and words', () => {
    const secs = sectionsOf(lks, info)
    expect(secs.map(s => s.name).sort()).toEqual([...new Set(lks.map(l => l.section))].sort())
    expect(secs.reduce((t, s) => t + s.item.fc, 0)).toBeCloseTo(lks.reduce((t, l) => t + l.fc, 0))
    for (const s of secs) expect(sectionLine(s)).toBe(`${s.teamLeader} · ${s.answered}/${s.lines.length} answered`)
    expect(fullyAnswered(secs)).toBe(secs.filter(s => s.answered === s.lines.length).length)
    expect(sectionLine({ teamLeader: undefined, answered: null, lines: lks.slice(0, 3) })).toBe('No Team Leader · 3 subcategories')
  })
})

describe('the Section Board', () => {
  const secs = sectionsOf(lks, info)
  it('orders sections furthest behind AOP first, by change on last year, or biggest first', () => {
    const gap = boardOrder(secs, 'aop').map(s => s.item.fc - s.item.aop)
    expect(gap).toEqual([...gap].sort((a, b) => a - b))
    const ly = boardOrder(secs, 'ly').map(s => Math.abs(s.item.fc - s.item.ly))
    expect(ly).toEqual([...ly].sort((a, b) => b - a))
    const size = boardOrder(secs, 'size').map(s => s.item.fc)
    expect(size).toEqual([...size].sort((a, b) => b - a))
  })
  it('fills the meter to 80% at AOP and stops at the end', () => {
    expect(meterWidth({ fc: 100, aop: 100 })).toBe(80)
    expect(meterWidth({ fc: 50, aop: 100 })).toBe(40)
    expect(meterWidth({ fc: 500, aop: 100 })).toBe(100)
    expect(meterWidth({ fc: 5, aop: 0 })).toBe(0)
  })
})

describe('opening the tree for a scope', () => {
  it('opens nothing for the whole store, every shared level for a floor, and down to the few subcategories', () => {
    expect(focusOpen(lks, STORE_LAYOUT, false).size).toBe(0)
    const floor = lks.filter(l => l.floor === 'Third Floor')
    const open = focusOpen(floor, STORE_LAYOUT, true)
    expect(open.has('Third Floor')).toBe(true)
    for (const l of floor) for (const id of pathTo(l, STORE_LAYOUT)) expect(open.has(id)).toBe(true)
    const girls = lks.filter(l => l.subdivision === 'Girls')
    const merch = focusOpen(girls, MERCHANDISE, true)
    expect(merch.has('Fashion')).toBe(true)
    expect(merch.has('Fashion › Girls')).toBe(true)
  })
})

describe('on a real Run', () => {
  it('claims no answers the app does not hold', () => {
    expect(answeredIn('Sarees', 5, 'Asha', false)).toBe(0)
    expect(answeredIn('Sarees', 5, undefined, false)).toBeNull()
  })
})
