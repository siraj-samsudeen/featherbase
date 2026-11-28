import { describe, expect, it } from 'vitest'
import { causesProblem, tagOf } from '../causes'
import { dayIsOff, daysOf, edgeOf, explanationFor, explanationOf, lineIsOff, loadedTo, subDaysFrom, type ActualsDayRow, type ForecastDayRow } from './days'

const fc = (sub: string, day: number, v: number): ForecastDayRow => ({ store_code: 'S', subcategory_name: sub, forecast_date: `2026-11-${String(day).padStart(2, '0')}`, forecast_value_before_tax: v })
const sold = (sub: string, day: number, v: number, asOf = '2026-11-03'): ActualsDayRow => ({ store_code: 'S', subcategory_name: sub, sales_date: `2026-11-${String(day).padStart(2, '0')}`, sales_value_before_tax: v, actuals_as_of_date: asOf })
const lines = [{ name: 'A', category: 'C', section: 'Sec' }, { name: 'B', category: 'C', section: 'Sec' }]

describe('the day review (#1425)', () => {
  it('reads how far sales are loaded from the copies', () => {
    expect(loadedTo([sold('A', 1, 10, '2026-11-27')], '2026-11-01')).toBe(27)
    expect(loadedTo([sold('A', 1, 10, '2026-12-02')], '2026-11-01')).toBe(31)
    expect(loadedTo([], '2026-12-01')).toBe(0)
  })

  it('puts each subcategory on its days; a loaded day with no sales row sold nothing, a day not loaded is unknown', () => {
    const [a] = subDaysFrom(lines, [fc('A', 1, 100), fc('A', 2, 100)], [sold('A', 1, 90)], 'S', 30, 2)
    expect(a.fc.slice(0, 3)).toEqual([100, 100, 0])
    expect(a.sold.slice(0, 3)).toEqual([90, 0, null])
  })

  it('gives each day and the month to date, with the % off Feather Forecast', () => {
    const subs = subDaysFrom(lines, [fc('A', 1, 100), fc('B', 1, 100), fc('A', 2, 100), fc('B', 2, 100)], [sold('A', 1, 80), sold('B', 1, 90), sold('A', 2, 110), sold('B', 2, 120)], 'S', 30, 2)
    const [d1, d2, d3] = daysOf(subs, 30)
    expect(d1).toMatchObject({ fc: 200, sold: 170, mtdFc: 200, mtdSold: 170 })
    expect(d1.off).toBeCloseTo(-15)
    expect(d2.mtdOff).toBeCloseTo(0)
    expect(d3).toMatchObject({ sold: null, off: null, mtdFc: 400, mtdSold: null })
  })

  it('asks for a reason when a day is more than 10% off; one day shows a subcategory off on the day or to date', () => {
    expect(dayIsOff({ off: -15.6 })).toBe(true)
    expect(dayIsOff({ off: 10 })).toBe(false)
    expect(lineIsOff({ off: 2.8, mtdOff: -20.5 })).toBe(true)
    expect([edgeOf(-15.6), edgeOf(13.5), edgeOf(-9.4), edgeOf(null)]).toEqual(['under', 'over', null, null])
  })

  it("keeps the newest explanation of a day, for the section's day apart from a subcategory's", () => {
    const row = (id: string, at: string, sub: string | null) => explanationOf({ row_id: id, updated_at: at, subcategory_name: sub, explained_date: '2026-11-03',
      causes: 'Weak store execution', tags: tagOf('Weak store execution', 'Low footfall'), note: 'Rain', explained_by: 'Anisha' })
    const all = [row('1', '2026-11-04T10:00', null), row('2', '2026-11-05T10:00', null), row('3', '2026-11-05T11:00', 'A')]
    expect(explanationFor(all, 3, null)?.id).toBe('2')
    expect(explanationFor(all, 3, 'A')).toMatchObject({ id: '3', causes: ['Weak store execution'], tags: ['Weak store execution › Low footfall'] })
    expect(explanationFor(all, 4, null)).toBeUndefined()
  })

  it('takes one or more of the five causes, each tag only under a picked cause', () => {
    expect(causesProblem([], [])).toBe('Pick at least one cause')
    expect(causesProblem(['Weak store execution', 'Stock not available'], [tagOf('Weak store execution', 'Low footfall'), tagOf('Stock not available', 'Size or colour missing')])).toBeNull()
    expect(causesProblem(['Bad luck'], [])).toBe('Bad luck is not one of the causes')
    expect(causesProblem(['Weak store execution'], [tagOf('Stock not available', 'Inaccurate stock')])).toBe('Stock not available › Inaccurate stock is under Stock not available, which is not picked')
    expect(causesProblem(['Weak store execution'], [tagOf('Weak store execution', 'Too hot')])).toBe('Weak store execution › Too hot is not a tag of a cause')
  })
})
