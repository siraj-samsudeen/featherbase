// The report's shared rules, over made-up places: a store's heading, the month's period and the
// day format. Made-up stores 9901 and 9902; no real figure.
import { describe, expect, it } from 'vitest'
import { headingOf, periodOf } from './report.ts'
import type { Place } from './provider.ts'

const place = (label: string, store: string, subcategory?: string[]): Place =>
  ({ label, filters: subcategory ? { store: [store], subcategory } : { store: [store] } })

describe('places that name less', () => {
  it('a place with no store adds no heading', () => {
    expect(headingOf([{ label: 'Everything', filters: {} }], '9901', 'Lakeside').sections).toEqual([])
  })
})

describe('the period', () => {
  it('is the month to date', () => {
    expect(periodOf('2026-10-15')).toEqual({ period_start: '2026-10-01', period_end: '2026-10-15' })
  })

  // #750
  it.each([
    ['2026-11-01', '2026-10-01', '2026-10-31'],
    ['2027-01-15', '2026-12-01', '2026-12-31'],
    ['2028-03-31', '2028-02-01', '2028-02-29'],
    ['2026-10-31', '2026-09-01', '2026-09-30'],
  ])('on %s, last month is %s to %s', (today, start, end) => {
    expect(periodOf(today, 'last')).toEqual({ period_start: start, period_end: end })
  })
})

describe("a store's heading", () => {
  const based = (label: string, store: string, subcategory: string[] | undefined, basis: string): Place => ({ ...place(label, store, subcategory), basis })

  it("gives each basis on the store's places with the sections those places name", () => {
    const places = [
      based('9901 / Section: Sarees', '9901', ['010101001'], 'team_leader'),
      based('9901 / Section: Tops', '9901', ['010303002'], 'section_staff, team_leader'),
      based('9901 / Section: Kids', '9901', ['010202001'], 'section_staff'),
    ]
    expect(headingOf(places, '9901', 'LKS')).toEqual({ name: 'LKS', sections: ['Kids', 'Sarees', 'Tops'], reasons: [
      { basis: 'section_staff', sections: ['Kids', 'Tops'] },
      { basis: 'team_leader', sections: ['Sarees', 'Tops'] },
    ] })
  })

  it("never carries another store's reasons or sections", () => {
    const places = [based('9901 / Section: Sarees', '9901', ['010101001'], 'team_leader'), based('9902', '9902', undefined, 'store_manager'),
      based('9902 / Section: Belts', '9902', ['010404001'], 'store_manager')]
    expect(headingOf(places, '9901', null)).toEqual({ name: null, sections: ['Sarees'], reasons: [{ basis: 'team_leader', sections: ['Sarees'] }] })
  })

  it("gives a whole-store place's basis with no section of its own", () => {
    const places = [based('9901', '9901', undefined, 'store_manager'), based('9901 / Section: Sarees', '9901', ['010101001'], 'store_manager')]
    expect(headingOf(places, '9901', 'LKS').reasons).toEqual([{ basis: 'store_manager', sections: ['Sarees'] }])
  })

  it('gives a basis whose places name no section (subcategories outside the map) with no sections', () => {
    expect(headingOf([based('9901', '9901', ['010909001'], 'assignment')], '9901', 'LKS'))
      .toEqual({ name: 'LKS', sections: [], reasons: [{ basis: 'assignment', sections: [] }] })
  })

  it('gives no reason for places that carry no basis', () => {
    expect(headingOf([place('9901 / Section: Sarees', '9901', ['010101001'])], '9901', 'LKS').reasons).toEqual([])
  })
})

// #1240: the server's own day format, so the server bundle carries no page code; the page writes days the same way.
describe('a day as people read it', () => {
  it('matches the page\'s DD-Mon-YYYY, across a month and a year boundary', async () => {
    const { dayLabel } = await import('./report.ts')
    const { shortDay } = await import('./page.ts')
    for (const day of ['2026-04-01', '2026-01-31', '2026-02-01', '2025-12-31'])
      expect(dayLabel(day)).toBe(shortDay(day))
    expect(dayLabel('2026-04-01')).toBe('01-Apr-2026')
  })
})
