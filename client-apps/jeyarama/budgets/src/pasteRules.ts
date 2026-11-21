// Reading cells copied from Excel into rows the app can save. Each row comes back with what
// is wrong with it in words, so the person fixes the sheet and pastes again; nothing is saved
// while any row has a problem.
import { fmtMonth } from './words'

export { pastedCells } from '@featherbase/shop-floor/pasted'

export interface CheckedRow<V> { cells: string[]; problem?: string; values: V[] }
export interface Checked<V> { headings: string[]; rows: CheckedRow<V>[]; problem?: string }

/** An amount as Excel shows it: grouped, with ₹, in brackets when negative, a dash for nothing. */
export function amountOf(text: string): number | null {
  const cell = text.replace(/[₹,\s]/g, '')
  if (!cell) return null
  if (cell === '-' || cell === '–' || cell === '—') return 0
  const bracketed = /^\((.+)\)$/.exec(cell)
  const digits = bracketed ? bracketed[1] : cell
  if (!/^-?\d+(\.\d+)?$/.test(digits)) return null
  return bracketed ? -Number(digits) : Number(digits)
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const monthStart = (year: number, monthNo: number) => monthNo >= 1 && monthNo <= 12 ? `${year < 100 ? 2000 + year : year}-${String(monthNo).padStart(2, '0')}-01` : null

/** A month heading (Oct'26, Oct 2026, 2026-10, 31-10-2026, 31-Oct-2026) as the first day of that month. */
export function monthOf(heading: string): string | null {
  const text = heading.trim().toLowerCase()
  let match = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(text)
  if (match) return monthStart(Number(match[1]), Number(match[2]))
  match = /^\d{1,2}[-/.](\d{1,2})[-/.](\d{4})$/.exec(text)
  if (match) return monthStart(Number(match[2]), Number(match[1]))
  match = /^(?:\d{1,2}[-\s])?([a-z]{3})[a-z]*[\s'’-]*(\d{2}|\d{4})$/.exec(text)
  if (match && MONTHS.includes(match[1])) return monthStart(Number(match[2]), MONTHS.indexOf(match[1]) + 1)
  return null
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const headed = (headings: string[], wanted: string[]) => wanted.every((name, index) => same(headings[index] ?? '', name))

export interface PlantName { row_id: string; plant_name: string | null; legal_company?: string | null }
const plantOf = (plants: PlantName[], cell: string) => plants.find(p => same(p.row_id, cell) || same(p.plant_name ?? '', cell))

export interface BudgetValue { plant: string; pl_line: string; budget_month: string; amount: number }
interface LineName { row_id: string; line_name: string; level: string; line_kind: string }

/** A block of Store, Line, then a column per month. Amounts are rupees. */
export function checkBudget(cells: string[][], known: { plants: PlantName[]; lines: LineName[]; months: string[] }): Checked<BudgetValue> {
  const headings = cells[0] ?? []
  const months = headings.slice(2).map(monthOf)
  if (!headed(headings, ['Store', 'Line']) || !months.length || months.includes(null))
    return { headings, rows: [], problem: 'The first row needs the headings Store, Line, then one month per column' }
  const outside = months.findIndex(month => !known.months.includes(month!))
  if (outside >= 0) return { headings, rows: [], problem: `${fmtMonth(months[outside]!)} is outside the months this version covers` }
  if (cells.length < 2) return { headings, rows: [], problem: 'Nothing to save: paste at least one row under the headings' }
  const seen = new Map<string, number>()
  const rows = cells.slice(1).map((row, index): CheckedRow<BudgetValue> => {
    const bad = (problem: string) => ({ cells: row, problem, values: [] })
    const plant = plantOf(known.plants, row[0] ?? '')
    if (!plant) return bad(`No store is called ${row[0] || '(blank)'}`)
    const line = known.lines.find(l => same(l.line_name, row[1] ?? '') || same(l.row_id, row[1] ?? ''))
    if (!line) return bad(`No P&L line is called ${row[1] || '(blank)'}`)
    if (line.line_kind === 'Subtotal') return bad(`${line.line_name} is a subtotal: it is worked out, not budgeted`)
    if (line.level !== 'Published') return bad(`${line.line_name} is a working line: a budget is held on published lines`)
    const key = `${plant.row_id}|${line.row_id}`
    if (seen.has(key)) return bad(`${row[0]} and ${line.line_name} are already on row ${seen.get(key)}`)
    seen.set(key, index + 1)
    const values: BudgetValue[] = []
    for (const [column, month] of months.entries()) {
      const cell = row[column + 2] ?? ''
      if (!cell) continue
      const amount = amountOf(cell)
      if (amount === null) return bad(`${fmtMonth(month!)} is not a number: ${cell}`)
      values.push({ plant: plant.row_id, pl_line: line.row_id, budget_month: month!, amount })
    }
    return { cells: row, values }
  })
  return { headings, rows }
}

export const ADJUSTMENT_TYPES = ['Provision', 'Reallocation', 'Capitalise', 'Defer', 'Recover'] as const
export interface AdjustmentValue { plant: string; gl_account: string; pl_line: string; amount: number; adjustment_type: string; reason: string }
interface AccountName { row_id: string; account_name: string; pl_line: string | null }

/** Rows of Store, Account, Amount, Type, Reason. The P&L line is the account's. */
export function checkAdjustments(cells: string[][], known: { plants: PlantName[]; accounts: AccountName[]; company?: string }): Checked<AdjustmentValue> {
  const headings = cells[0] ?? []
  if (!headed(headings, ['Store', 'Account', 'Amount', 'Type', 'Reason']))
    return { headings, rows: [], problem: 'The first row needs the headings Store, Account, Amount, Type, Reason' }
  if (cells.length < 2) return { headings, rows: [], problem: 'Nothing to save: paste at least one row under the headings' }
  const rows = cells.slice(1).map((row): CheckedRow<AdjustmentValue> => {
    const bad = (problem: string) => ({ cells: row, problem, values: [] })
    const [store = '', accountCell = '', amountCell = '', typeCell = '', reason = ''] = row
    const plant = plantOf(known.plants, store)
    if (!plant) return bad(`No store is called ${store || '(blank)'}`)
    // A close is one company's: a plant on another company's books has no place in it.
    if (known.company && plant.legal_company && plant.legal_company !== known.company) return bad(`${plant.plant_name ?? plant.row_id} belongs to another company than this close`)
    const account = known.accounts.find(a => same(a.row_id, accountCell) || same(a.account_name, accountCell))
    if (!account) return bad(`No account is called ${accountCell || '(blank)'}`)
    if (!account.pl_line) return bad(`${account.account_name} has no P&L line yet: classify it first`)
    const amount = amountOf(amountCell)
    if (amount === null) return bad(`Amount is not a number: ${amountCell || '(blank)'}`)
    const type = ADJUSTMENT_TYPES.find(t => same(t, typeCell))
    if (!type) return bad(`Type is one of ${ADJUSTMENT_TYPES.join(', ')}: not ${typeCell || '(blank)'}`)
    if (!reason) return bad('Say the reason')
    return { cells: row, values: [{ plant: plant.row_id, gl_account: account.row_id, pl_line: account.pl_line, amount, adjustment_type: type, reason }] }
  })
  return { headings, rows }
}
