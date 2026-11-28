import type { PageTableColumn } from 'shared'
import { asNumber, formatCurrency, formatDate, formatNumber, type Row } from './grammar'

// #1410: what a page's Table part works out before it draws. A page has no
// arithmetic of its own: a group's total is the one sum, and the Table adds it.

/** A row with its place among all the table's rows, which is where a value typed into it is written. */
export interface PlacedRow { row: Row; index: number }
export interface RowGroup { key: string; name: string; rows: PlacedRow[] }

/** What the group of rows with no value in the grouped column is called. It is also its key, so the group can be the open one. */
const NO_VALUE = 'None'

/** One group per value of `column`, in the order the values first appear. */
export function groupRows(rows: Row[], column: string): RowGroup[] {
  const groups = new Map<string, RowGroup>()
  rows.forEach((row, index) => {
    const value = row[column]
    const key = value === null || value === undefined || value === '' ? NO_VALUE : String(value)
    if (!groups.has(key)) groups.set(key, { key, name: key, rows: [] })
    groups.get(key)!.rows.push({ row, index })
  })
  return [...groups.values()]
}

/** The numbers added up, or nothing when none of the values is a number. */
export function sumOf(values: unknown[]): number | null {
  const numbers = values.map(asNumber).filter((value): value is number => value !== null)
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null
}

/** A value as a column's `format` says. */
export function formatCell(value: unknown, format: PageTableColumn['format']): string {
  if (format === 'number') return formatNumber(value)
  if (format === 'currency') return formatCurrency(value)
  if (format === 'date') return formatDate(value)
  return value === null || value === undefined ? '' : String(value)
}
