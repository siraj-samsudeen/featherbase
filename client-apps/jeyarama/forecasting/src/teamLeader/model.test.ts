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
