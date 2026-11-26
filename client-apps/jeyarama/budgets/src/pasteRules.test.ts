import { describe, expect, it } from 'vitest'
import { amountOf, checkAdjustments, checkBudget, monthOf, pastedCells } from './pasteRules'

describe('reading what was pasted', () => {
  it('splits rows and tab-separated cells, dropping blank rows and trimming', () => {
    expect(pastedCells('Store\tLine \tOct\'26\r\n\r\n9003\tManpower Cost\t18.40\n')).toEqual([['Store', 'Line', "Oct'26"], ['9003', 'Manpower Cost', '18.40']])
  })
  it('reads an amount as Excel shows it', () => {
    expect(amountOf('1,84,000.50')).toBe(184000.5)
    expect(amountOf('₹ 42,500')).toBe(42500)
    expect(amountOf('(1,200)')).toBe(-1200)
    expect(amountOf('-75.25')).toBe(-75.25)
    expect(amountOf('-')).toBe(0)
    expect(amountOf('')).toBe(null)
    expect(amountOf('n/a')).toBe(null)
  })
  it('reads a month heading in the forms a workbook uses', () => {
    for (const heading of ["Oct'26", 'Oct-26', 'Oct 2026', 'October 2026', '2026-10', '31-10-2026', '31-Oct-2026', '2026-10-31'])
      expect(monthOf(heading), heading).toBe('2026-10-01')
    expect(monthOf('Total')).toBe(null)
  })
})

const plants = [{ row_id: '9003', plant_name: 'Hilltop' }, { row_id: '9004', plant_name: 'Lakeside' }]
const lines = [
  { row_id: 'manpower_cost', line_name: 'Manpower Cost', level: 'Published', line_kind: 'Posted' },
  { row_id: 'store_ebitda', line_name: 'Store EBITDA', level: 'Published', line_kind: 'Subtotal' },
  { row_id: 'salaries', line_name: 'Salaries', level: 'Working', line_kind: 'Posted' },
]

describe('a pasted budget block', () => {
  const months = ['2026-10-01', '2026-11-01']
  it('becomes one amount for each store, line and month, in rupees', () => {
    const checked = checkBudget([['Store', 'Line', "Oct'26", "Nov'26"], ['9003', 'Manpower Cost', '18,40,000', '18,60,000'], ['lakeside', 'manpower cost', '9,00,000', '']], { plants, lines, months })
    expect(checked.problem).toBeUndefined()
    expect(checked.rows.map(row => row.problem)).toEqual([undefined, undefined])
    expect(checked.rows.flatMap(row => row.values)).toEqual([
      { plant: '9003', pl_line: 'manpower_cost', budget_month: '2026-10-01', amount: 1840000 },
      { plant: '9003', pl_line: 'manpower_cost', budget_month: '2026-11-01', amount: 1860000 },
      { plant: '9004', pl_line: 'manpower_cost', budget_month: '2026-10-01', amount: 900000 },
    ])
  })
  it('says on its row what is wrong: a store or line it does not know, a subtotal, a figure that is not a number', () => {
    const checked = checkBudget([['Store', 'Line', "Oct'26"], ['9999', 'Manpower Cost', '1'], ['9003', 'Rent', '1'], ['9003', 'Store EBITDA', '1'], ['9003', 'Salaries', '1'], ['9003', 'Manpower Cost', 'abc']], { plants, lines, months })
    expect(checked.rows.map(row => row.problem)).toEqual([
      'No store is called 9999', 'No P&L line is called Rent', 'Store EBITDA is a subtotal: it is worked out, not budgeted',
      'Salaries is a working line: a budget is held on published lines', "Oct'26 is not a number: abc",
    ])
  })
  it('refuses a block whose headings it cannot read, or a month the version does not cover', () => {
    expect(checkBudget([['Shop', 'Line', "Oct'26"]], { plants, lines, months }).problem).toBe('The first row needs the headings Store, Line, then one month per column')
    expect(checkBudget([['Store', 'Line', "Sep'26"], ['9003', 'Manpower Cost', '1']], { plants, lines, months }).problem).toBe("Sep'26 is outside the months this version covers")
    expect(checkBudget([['Store', 'Line', "Oct'26"]], { plants, lines, months }).problem).toBe('Nothing to save: paste at least one row under the headings')
  })
  it('takes the published line when a working line has the same name', () => {
    const twins = [...lines, { row_id: 'interest', line_name: 'Interest', level: 'Published', line_kind: 'Posted' }, { row_id: 'interest_posted', line_name: 'Interest', level: 'Working', line_kind: 'Posted' }]
    for (const cell of ['Interest', 'interest']) {
      const checked = checkBudget([['Store', 'Line', "Oct'26"], ['9003', cell, '5']], { plants, lines: [...twins].reverse(), months })
      expect(checked.rows[0].problem, cell).toBeUndefined()
      expect(checked.rows[0].values[0].pl_line).toBe('interest')
    }
  })
  it('names a store, line and month that appear twice', () => {
    const checked = checkBudget([['Store', 'Line', "Oct'26"], ['9003', 'Manpower Cost', '1'], ['Hilltop', 'Manpower Cost', '2']], { plants, lines, months })
    expect(checked.rows[1].problem).toBe('Hilltop and Manpower Cost are already on row 1')
  })
})

describe('pasted adjustment lines', () => {
  const accounts = [{ row_id: '49990001', account_name: 'Staff Tea And Snacks', pl_line: 'salaries' }, { row_id: '49990002', account_name: 'Not Classified Yet', pl_line: null }]
  it('become one adjustment each, with the line taken from the account', () => {
    const checked = checkAdjustments([['Store', 'Account', 'Amount', 'Type', 'Reason'], ['9003', '49990001', '42,500', 'provision', 'Provision for October electricity bill not received'], ['Lakeside', 'Staff Tea And Snacks', '(1,200)', 'Reallocation', 'Moved from head office']], { plants, accounts })
    expect(checked.problem).toBeUndefined()
    expect(checked.rows.flatMap(row => row.values)).toEqual([
      { plant: '9003', gl_account: '49990001', pl_line: 'salaries', amount: 42500, adjustment_type: 'Provision', reason: 'Provision for October electricity bill not received' },
      { plant: '9004', gl_account: '49990001', pl_line: 'salaries', amount: -1200, adjustment_type: 'Reallocation', reason: 'Moved from head office' },
    ])
  })
  it('says on its row what is wrong', () => {
    const checked = checkAdjustments([['Store', 'Account', 'Amount', 'Type', 'Reason'], ['9003', '1', '5', 'Provision', 'x'], ['9003', '49990002', '5', 'Provision', 'x'], ['9003', '49990001', '', 'Provision', 'x'], ['9003', '49990001', '5', 'Guess', 'x'], ['9003', '49990001', '5', 'Provision', '']], { plants, accounts })
    expect(checked.rows.map(row => row.problem)).toEqual([
      'No account is called 1', 'Not Classified Yet has no P&L line yet: classify it first', 'Amount is not a number: (blank)',
      'Type is one of Provision, Reallocation, Capitalise, Defer, Recover: not Guess', 'Say the reason',
    ])
  })
  it('keeps a close to the plants of its own company', () => {
    const mixed = [{ row_id: '9003', plant_name: 'Hilltop', legal_company: '9000' }, { row_id: '9901', plant_name: 'Gold House', legal_company: '9900' }, { row_id: '9005', plant_name: 'Riverside', legal_company: null }]
    const checked = checkAdjustments([['Store', 'Account', 'Amount', 'Type', 'Reason'], ['Gold House', '49990001', '5', 'Provision', 'x'], ['Hilltop', '49990001', '5', 'Provision', 'x'], ['Riverside', '49990001', '5', 'Provision', 'x']], { plants: mixed, accounts, company: '9000' })
    expect(checked.rows.map(row => row.problem)).toEqual(['Gold House belongs to another company than this close', undefined, undefined])
  })
  it('refuses other headings', () => {
    expect(checkAdjustments([['Store', 'Amount']], { plants, accounts }).problem).toBe('The first row needs the headings Store, Account, Amount, Type, Reason')
  })
})
