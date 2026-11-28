// How Applied numbers combine with the engine (combine.ts): the rules in its header, checked on the made-up data.
import { describe, expect, it } from 'vitest'
import { combine, figureOf, percentEffect, proposedTotal } from './combine'
import { ALL_WEEKS, SUBS } from './madeUp'
import { finalWeeks } from './sales'
import { monthOf } from './months'
import type { NumberRow } from './App'

const m = monthOf('2026-11')
const STORE = 'Lakeside'
const subs = SUBS.filter(s => s.store === STORE)
const cat = subs[0].category
const inCat = subs.filter(s => s.category === cat)
const [first, second] = inCat
let seq = 0
const n = (over: Partial<NumberRow>): NumberRow => ({
  row_id: `T-${++seq}`, month: m.key, run: m.run ?? '', store: STORE, section: '', scope_level: 'Subcategory', scope_name: first.name,
  weeks: null, kind: 'Set a total', value: 0, weights_json: null, entered_by: 'Kumar', entered_by_role: 'Chief Executive',
  entered_on: '2026-11-03', reason: 'test', status: 'Applied', waiting_on: null, changed_by: null, percent: null, ...over,
})
const engine = (names: string[], weeks = ALL_WEEKS) => subs.filter(s => names.includes(s.name)).reduce((t, s) => t + finalWeeks(s, m, weeks), 0)
const total = (adj: Map<string, number[]>, names: string[], weeks = ALL_WEEKS) => names.reduce((t, name) => t + weeks.reduce((u, w) => u + adj.get(name)![w - 1], 0), 0)
const names = (list: typeof subs) => list.map(s => s.name)

describe('combine', () => {
  it('leaves the engine as it is when nothing is applied', () => {
    const { adj } = combine([n({ status: 'Waiting' }), n({ status: 'Reference' })], STORE, m)
    expect(total(adj, names(subs))).toBeCloseTo(engine(names(subs)), 2)
  })

  it('spreads a total over a subcategory month by the engine\'s own weekly shape', () => {
    const want = Math.round(engine([first.name]) * 1.2)
    const { adj } = combine([n({ value: want })], STORE, m)
    expect(total(adj, [first.name])).toBeCloseTo(want, 2)
    const share = (w: number) => adj.get(first.name)![w - 1] / want
    ALL_WEEKS.forEach(w => expect(share(w)).toBeCloseTo(finalWeeks(first, m, [w]) / engine([first.name]), 6))
  })

  it('keeps a more specific number as entered and moves the rest of a category by its percent', () => {
    const held = Math.round(engine([first.name]) * 0.5)
    const { adj } = combine([
      n({ scope_level: 'Category', scope_name: cat, kind: 'Change by a percent', percent: 10 }),
      n({ value: held }),
    ], STORE, m)
    expect(total(adj, [first.name])).toBeCloseTo(held, 2)
    expect(total(adj, [second.name])).toBeCloseTo(engine([second.name]) * 1.1, 2)
  })

  it('spreads what is left of a category total after the more specific number inside it', () => {
    const held = Math.round(engine([first.name]) * 2)
    const want = Math.round(engine(names(inCat)))
    const { adj } = combine([n({ scope_level: 'Category', scope_name: cat, value: want }), n({ value: held })], STORE, m)
    expect(total(adj, names(inCat))).toBeCloseTo(want, 2)
    expect(total(adj, [first.name])).toBeCloseTo(held, 2)
  })

  it('a closure sets its weeks to nothing, and a week number wins over the month inside it', () => {
    const wk = Math.round(engine([first.name], [2]) * 3)
    const { adj } = combine([n({ kind: 'Closure or event', percent: -100 }), n({ weeks: '2', value: wk })], STORE, m)
    expect(adj.get(first.name)![1]).toBeCloseTo(wk, 2)
    expect(total(adj, [first.name], [1, 3, 4, 5])).toBeCloseTo(0, 6)
  })
})

describe('figureOf and percentEffect', () => {
  it('a percent\'s figure is its own cells moved plus the cells a more specific number holds', () => {
    const held = Math.round(engine([first.name]) * 0.5)
    const pc = n({ scope_level: 'Category', scope_name: cat, kind: 'Change by a percent', percent: 10 })
    const all = [pc, n({ value: held })]
    const rest = engine(names(inCat).filter(x => x !== first.name))
    expect(figureOf(pc, all)).toBeCloseTo(held + rest * 1.1, 2)
    expect(percentEffect(pc, all)).toBeCloseTo(rest * 0.1, 2)
  })
})

describe('proposedTotal', () => {
  it('counts a nested number once', () => {
    const held = Math.round(engine([first.name]) * 2)
    const want = Math.round(engine(names(inCat)) * 1.5)
    const all = [n({ scope_level: 'Category', scope_name: cat, value: want }), n({ value: held })]
    const others = engine(names(subs).filter(x => !names(inCat).includes(x)))
    expect(proposedTotal(all, [STORE], m)).toBeCloseTo(others + want, 1)
  })
})
