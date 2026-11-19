// #750: the page's month choice, this month or last month. Made-up stores and figures.
import { describe, expect, it } from 'vitest'
import { isMonthChoice, monthChooser, pageView, reportLoader, visibleState } from './page.ts'

describe('choosing a month', () => {
  const loader = () => {
    const selected: [string, string | undefined][] = []
    return { selected, select: (store: string, month?: string) => { selected.push([store, month]) } }
  }

  it('drops the answers on show at once and sets the month', () => {
    const l = loader()
    const set: string[] = []
    monthChooser(l, () => '9901', m => { set.push(m) })('last')
    expect([l.selected, set]).toEqual([[['9901', 'last']], ['last']])
  })

  it('changes nothing for the month on show, as when the bar announces its first option', () => {
    const l = loader()
    const set: string[] = []
    monthChooser(l, () => '9901', m => { set.push(m) })('this')
    expect([l.selected, set]).toEqual([[], []])
  })

  it('starts from the month in the address', () => {
    const l = loader()
    const set: string[] = []
    monthChooser(l, () => '9901', m => { set.push(m) }, 'last')('last')
    expect(set).toEqual([])
  })

  it('ignores a month the page does not offer', () => {
    const l = loader()
    const set: string[] = []
    monthChooser(l, () => '9901', m => { set.push(m) })('2026-09')
    expect([l.selected, set, isMonthChoice('last'), isMonthChoice('next')]).toEqual([[], [], true, false])
  })

  it('sets the month before any store is known, selecting nothing', () => {
    const l = loader()
    const set: string[] = []
    monthChooser(l, () => undefined, m => { set.push(m) })('last')
    expect([l.selected, set]).toEqual([[], ['last']])
  })
})

describe('what is drawn for the month chosen', () => {
  const state = { store: '9901', month: 'this', embed: { ok: true }, report: { ok: true }, frameFailed: false, timedOut: false, diveReady: true }

  it("draws nothing of this month's state once last month is chosen", () => {
    expect(visibleState(state, '9901', 'last')).toEqual({ ...state, month: 'last', embed: undefined, report: undefined, diveReady: false })
  })

  it('draws the state of the store and month on show', () => {
    expect(visibleState(state, '9901', 'this')).toBe(state)
  })
})

describe('opening a month', () => {
  it('asks both reads for the month chosen', async () => {
    const asked: [string, Record<string, unknown>][] = []
    const l = reportLoader((name, payload) => { asked.push([name, payload]); return new Promise(() => {}) }, () => {})
    l.open('9901', 'last')
    expect(asked).toEqual([['report', { store: '9901', month: 'last' }], ['embed_session', { store: '9901', month: 'last' }]])
  })

  it('names no month when none is chosen, so the server opens this month', () => {
    const asked: Record<string, unknown>[] = []
    reportLoader((_name, payload) => { asked.push(payload); return new Promise(() => {}) }, () => {}).open('9901')
    expect(asked).toEqual([{ store: '9901' }, { store: '9901' }])
  })
})

describe("the page for last month", () => {
  it('opens the interactive report for last month as for this month', () => {
    expect(pageView({ embed: { ok: true, value: { frame: 'https://embed-motherduck.com/sandbox/#session=s' } }, report: { ok: true, value: { state: 'ready' } } }))
      .toEqual({ kind: 'dive', src: 'https://embed-motherduck.com/sandbox/#session=s' })
  })
})
