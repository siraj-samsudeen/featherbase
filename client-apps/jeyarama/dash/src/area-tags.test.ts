import { describe, expect, it } from 'vitest'
import { AREAS, areaCounts, areasOf, bundleAreas, inArea, reportAreas } from './area-tags'

// Production's 17 Dash reports on 16-Nov-2026, with the areas a reader would file them under.
const REAL: [string, string[]][] = [
  ['ATK 1501 — Kurti TL Control Tower', ['Operations']],
  ['ATK Men T-Shirt Section Performance', ['Sales']],
  ['ATK Store TL Cockpit (all 6 floors)', ['Operations']],
  ['Fashion 100 · Women, Men & Kids — Live Stock & Replenishment', ['Inventory']],
  ['Fashion · ATK Store TL Cockpit (all 6 floors) (Preview #3524)', ['Operations']],
  ['Grocery · 1001 Replenishment Head Control Tower — KL', ['Inventory', 'Operations']],
  ['KL Home & Grocery · Category Head Dashboard', ['Buying']],
  ['KL Home & Grocery · P2P Command Centre', ['Buying']],
  ['KL Menswear Store Manager Control Tower + Assortment', ['Inventory', 'Operations']],
  ['KL + TN Inventory Health — Cover, Excess & Exceptions', ['Inventory']],
  ['KL Womenswear — Price Ranges by Buyer', ['Buying']],
  ['KL Womenswear Store Manager Control Tower + Assortment', ['Inventory', 'Operations']],
  ['Operations Dashboard', ['Operations']],
  ['Sales · Target vs Actual', ['Sales']],
  ['Store target MTD', ['Sales']],
  ['Vendor sales', ['Sales', 'Buying']],
  ['Women Buyers Dashboard', ['Buying']],
]

describe('areasOf (#1225)', () => {
  it.each(REAL)('%s', (name, areas) => expect(areasOf(name)).toEqual(areas))
  it('finds HR and Finance reports', () => {
    expect(areasOf('Cashier Scorecard')).toEqual(['HR'])
    expect(areasOf('Attendance Summary')).toEqual(['HR'])
    expect(areasOf('Chennai P&L Summary')).toEqual(['Finance'])
    expect(areasOf('Gross Margin by Store')).toEqual(['Finance'])
  })
  it('gives a name it can\'t place no area, never a guess', () => {
    expect(areasOf('Festival Planner')).toEqual([])
  })
  it('lists areas in one fixed order', () => {
    expect(AREAS).toEqual(['Sales', 'Inventory', 'Buying', 'Operations', 'HR', 'Finance'])
  })
})

describe('areaCounts (#1225)', () => {
  it('counts each report once per area, in the fixed order, leaving out empty areas', () => {
    expect(areaCounts(REAL.map(([name]) => ({ name })))).toEqual([
      { area: 'Sales', count: 4 }, { area: 'Inventory', count: 5 }, { area: 'Buying', count: 5 }, { area: 'Operations', count: 7 },
    ])
  })
})

describe('inArea and bundleAreas (#1225)', () => {
  const reports = [{ key: 'a', name: 'Vendor sales' }, { key: 'b', name: 'Operations Dashboard' }, { key: 'c', name: 'Festival Planner' }]
  it('no area chosen keeps everything; an area keeps only its reports', () => {
    expect(reports.filter(r => inArea(r, null)).map(r => r.key)).toEqual(['a', 'b', 'c'])
    expect(reports.filter(r => inArea(r, 'Buying')).map(r => r.key)).toEqual(['a'])
  })
  it('a bundle carries the areas of its reports, in the fixed order', () => {
    expect(bundleAreas(['b', 'a'], reports)).toEqual(['Sales', 'Buying', 'Operations'])
    expect(bundleAreas([], reports)).toEqual([])
  })
})

describe('reportAreas (#1225)', () => {
  it('areas chosen on adding win over the name; none chosen falls back to the name', () => {
    expect(reportAreas({ name: 'Vendor sales', areas: ['Finance', 'Sales'] })).toEqual(['Sales', 'Finance'])
    expect(reportAreas({ name: 'Vendor sales', areas: [] })).toEqual([])
    expect(reportAreas({ name: 'Vendor sales' })).toEqual(['Sales', 'Buying'])
  })
})
