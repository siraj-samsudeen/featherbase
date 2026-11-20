import { describe, expect, it } from 'vitest'
import { budgetInForce, difference, fiscalMonths, monthsBetween, remaining, statement, statementRows, versionInForce, type Line, type Version } from './plRules'

const line = (row_id: string, line_order: number, section: Line['section'], line_kind: Line['line_kind'], sign: Line['sign'], more: Partial<Line> = {}): Line =>
  ({ row_id, line_name: row_id, level: 'Published', rolls_into: null, line_order, section, line_kind, sign, subtotal_rule: null, ...more })

// A small P&L in the shape of the real one: a memo line, margin, opex with a credit in it, and three subtotals.
const LINES: Line[] = [
  line('net_sales', 20, 'Sales', 'Memo', 'Income'),
  line('scan_margin', 40, 'Margin', 'Posted', 'Income'),
  line('sales', 41, 'Margin', 'Posted', 'Income', { level: 'Working', rolls_into: 'scan_margin' }),
  line('cost_of_purchase', 42, 'Margin', 'Posted', 'Cost', { level: 'Working', rolls_into: 'scan_margin' }),
  line('shrinkage', 60, 'Margin', 'Posted', 'Cost'),
  line('net_margin', 70, 'Margin', 'Subtotal', 'Income', { subtotal_rule: 'Running Total' }),
  line('manpower_cost', 100, 'Store Opex', 'Posted', 'Cost'),
  line('salaries', 101, 'Store Opex', 'Posted', 'Cost', { level: 'Working', rolls_into: 'manpower_cost' }),
  line('pf', 102, 'Store Opex', 'Posted', 'Cost', { level: 'Working', rolls_into: 'manpower_cost' }),
  line('occupancy', 110, 'Store Opex', 'Posted', 'Cost'),
  line('charge_to_gold_house', 120, 'Store Opex', 'Standing Charge', 'Income'),
  line('total_store_opex', 190, 'Store Opex', 'Subtotal', 'Cost', { subtotal_rule: 'Section Total' }),
  line('store_ebitda', 200, 'Below Store EBITDA', 'Subtotal', 'Income', { subtotal_rule: 'Running Total' }),
]

describe('statement', () => {
  const amounts = new Map([['net_sales', 1000], ['sales', 1000], ['cost_of_purchase', 720], ['shrinkage', 5], ['salaries', 60], ['pf', 8], ['occupancy', 40], ['charge_to_gold_house', 10]])
  const rows = statement(LINES, amounts)
  const value = (id: string) => rows.find(row => row.line.row_id === id)?.amount

  it('lists published lines in order, each with its working lines under it', () => {
    expect(rows.map(row => row.line.row_id)).toEqual(['net_sales', 'scan_margin', 'shrinkage', 'net_margin', 'manpower_cost', 'occupancy', 'charge_to_gold_house', 'total_store_opex', 'store_ebitda'])
    expect(rows.find(row => row.line.row_id === 'manpower_cost')!.working.map(w => [w.line.row_id, w.amount])).toEqual([['salaries', 60], ['pf', 8]])
  })
  it('rolls working lines into their published line by sign: income less cost', () => {
    expect(value('scan_margin')).toBe(280)
    expect(value('manpower_cost')).toBe(68)
  })
  it('a running total adds every line above it by sign and leaves memo lines out', () => {
    expect(value('net_margin')).toBe(275)
  })
  it('a section total adds its own section, taking a credit away', () => {
    expect(value('total_store_opex')).toBe(98)
  })
  it('a later running total carries on through the sections above', () => {
    expect(value('store_ebitda')).toBe(177)
  })
  it('an amount held on a published line itself is used when it has no working amounts', () => {
    expect(statement(LINES, new Map([['scan_margin', 300], ['manpower_cost', 70]])).find(row => row.line.row_id === 'store_ebitda')!.amount).toBe(230)
  })
  it('a line with no amount is nothing, not a gap in the totals', () => {
    expect(statement(LINES, new Map()).every(row => row.amount === 0)).toBe(true)
  })
})

describe('the budget in force', () => {
  const version = (row_id: string, more: Partial<Version>): Version => ({ row_id, budget_kind: 'P&L', operating_region: 'North', covers_from: '2026-04-01', covers_to: '2027-03-01', version_state: 'Approved', approved_on: '2026-04-20', ...more })
  const original = version('BV-001', {})
  const revision = version('BV-002', { covers_from: '2026-10-01', approved_on: '2026-10-14' })
  const draft = version('BV-003', { covers_from: '2026-10-01', version_state: 'Draft', approved_on: null })
  const south = version('BV-004', { operating_region: 'South', approved_on: '2026-11-01' })
  const all = [original, revision, draft, south]

  it('is the latest approved version that covers the month', () => {
    expect(versionInForce(all, 'P&L', 'North', '2026-09-01')?.row_id).toBe('BV-001')
    expect(versionInForce(all, 'P&L', 'North', '2026-10-01')?.row_id).toBe('BV-002')
    expect(versionInForce(all, 'P&L', 'North', '2027-03-01')?.row_id).toBe('BV-002')
  })
  it('never a draft, another region or another kind', () => {
    expect(versionInForce([draft, south], 'P&L', 'North', '2026-10-01')).toBeUndefined()
    expect(versionInForce(all, 'Sales', 'North', '2026-10-01')).toBeUndefined()
  })
  it('a version with no region covers every region', () => {
    expect(versionInForce([version('BV-009', { operating_region: null })], 'P&L', 'South', '2026-05-01')?.row_id).toBe('BV-009')
  })
  it('gives each month its own version when a revision starts mid-year', () => {
    expect(budgetInForce(all, 'P&L', 'North', ['2026-09-01', '2026-10-01'])).toEqual(new Map([['2026-09-01', 'BV-001'], ['2026-10-01', 'BV-002']]))
  })
})

describe('months', () => {
  it('a fiscal year runs April to March', () => {
    const months = fiscalMonths('2026-10-01')
    expect(months).toHaveLength(12)
    expect([months[0], months[11]]).toEqual(['2026-04-01', '2027-03-01'])
    expect(fiscalMonths('2027-02-01')[0]).toBe('2026-04-01')
  })
  it('the months a version covers, both ends in', () => {
    expect(monthsBetween('2026-10-01', '2027-01-01')).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'])
  })
})

describe('what remains of an adjustment', () => {
  it('is the amount less what was matched, and it is settled at nothing', () => {
    expect(remaining(42500, null)).toEqual({ remaining: 42500, settled: false })
    expect(remaining(42500, 40000)).toEqual({ remaining: 2500, settled: false })
    expect(remaining(42500, 42500)).toEqual({ remaining: 0, settled: true })
    expect(remaining(-1200.1, -1200.1)).toEqual({ remaining: 0, settled: true })
  })
})

describe('the statement as rows of figures across columns', () => {
  const lines = LINES
  const hilltop = new Map([['sales', 1000], ['cost_of_purchase', 720], ['salaries', 60], ['pf', 8]])
  const lakeside = new Map([['sales', 500], ['cost_of_purchase', 380], ['salaries', 30]])
  const rows = statementRows(lines, [{ id: '9003', amounts: hilltop }, { id: '9004', amounts: lakeside }], 'all')

  it('gives each published line one row with a figure per column and a total of the columns', () => {
    expect(rows.find(row => row.id === 'scan_margin')!.values).toEqual({ 9003: 280, 9004: 120, all: 400 })
    expect(rows.find(row => row.id === 'store_ebitda')!.values).toEqual({ 9003: 212, 9004: 90, all: 302 })
  })
  it('marks subtotals strong and memo lines quiet, and folds working lines under their line', () => {
    expect(rows.find(row => row.id === 'store_ebitda')!.strong).toBe(true)
    expect(rows.find(row => row.id === 'net_sales')!.quiet).toBe(true)
    expect(rows.find(row => row.id === 'manpower_cost')!.children!.map(child => [child.id, child.values])).toEqual([['salaries', { 9003: 60, 9004: 30, all: 90 }], ['pf', { 9003: 8, 9004: 0, all: 8 }]])
  })
  it('leaves out working lines nobody has an amount on, and the total when none is asked for', () => {
    expect(rows.find(row => row.id === 'scan_margin')!.children!.map(child => child.id)).toEqual(['sales', 'cost_of_purchase'])
    expect(rows.find(row => row.id === 'occupancy')!.children).toBeUndefined()
    expect(statementRows(lines, [{ id: '9003', amounts: hilltop }])[1].values).toEqual({ 9003: 280 })
  })
  it('the difference of two sets of amounts, line by line', () => {
    expect([...difference(hilltop, lakeside)]).toEqual([['sales', 500], ['cost_of_purchase', 340], ['salaries', 30], ['pf', 8]])
  })
})
