// #1380: the FigureMatrix (shared, shop-floor): lines down, columns across, right-aligned
// figures, working rows folded under their line, subtotals in heavier type, a link per cell,
// and a cell changed in place by someone who may.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { FigureMatrix, fmtLakhs, type FigureColumn, type FigureRow } from '@featherbase/shop-floor'

afterEach(cleanup)

const COLUMNS: FigureColumn[] = [{ id: 'hil', label: 'Hilltop' }, { id: 'lak', label: 'Lakeside' }, { id: 'all', label: 'North', total: true }]
const ROWS: FigureRow[] = [
  { id: 'manpower', label: 'Manpower Cost', values: { hil: 1840000, lak: 900000, all: 2740000 }, children: [
    { id: 'salaries', label: 'Salaries', values: { hil: 1700000, lak: 820000, all: 2520000 } },
    { id: 'pf', label: 'PF', values: { hil: 140000, lak: 80000, all: 220000 } },
  ] },
  { id: 'credit', label: 'Charge To Gold House', values: { hil: -52660, lak: null, all: -52660 } },
  { id: 'ebitda', label: 'Store EBITDA', strong: true, values: { hil: 5000000, lak: 0, all: 5000000 } },
]
const matrix = (props: Partial<Parameters<typeof FigureMatrix>[0]> = {}) =>
  render(<FigureMatrix label="P&L by store" rowHeading="Line" columns={COLUMNS} rows={ROWS} format={fmtLakhs} {...props} />)
const cell = (row: string, column: string) => screen.getByTestId(`figure-${row}-${column}`)

describe('fmtLakhs', () => {
  test('says rupees in lakhs to two decimals, grouped the Indian way, with a leading minus', () => {
    expect(fmtLakhs(1840000)).toBe('18.40')
    expect(fmtLakhs(123456789)).toBe('1,234.57')
    expect(fmtLakhs(-52660)).toBe('-0.53')
    expect(fmtLakhs(0)).toBe('0.00')
    expect(fmtLakhs(null)).toBe('—')
  })
})

describe('the FigureMatrix', () => {
  test('is one table with a column heading per column and a row heading per line', () => {
    matrix()
    const table = screen.getByRole('table', { name: 'P&L by store' })
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Line', 'Hilltop', 'Lakeside', 'North'])
    expect(within(table).getAllByRole('rowheader').map(h => h.textContent)).toEqual(['Manpower Cost', 'Charge To Gold House', 'Store EBITDA'])
  })
  test('shows each figure through the format it is given, right-aligned in tabular figures; no figure is a dash', () => {
    matrix()
    expect(cell('manpower', 'hil').textContent).toBe('18.40')
    expect(cell('credit', 'hil').textContent).toBe('-0.53')
    expect(cell('credit', 'lak').textContent).toBe('—')
    expect(cell('ebitda', 'lak').textContent).toBe('0.00')
    expect(cell('manpower', 'hil').className).toMatch(/text-right/)
    expect(cell('manpower', 'hil').className).toMatch(/tabular-nums/)
  })
  test('a line with working rows unfolds to them, and folds again', () => {
    matrix()
    expect(screen.queryByText('Salaries')).toBeNull()
    const fold = screen.getByRole('button', { name: 'Manpower Cost' })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(fold)
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    expect(cell('salaries', 'lak').textContent).toBe('8.20')
    fireEvent.click(fold)
    expect(screen.queryByText('PF')).toBeNull()
  })
  test('a line without working rows has no fold control', () => {
    matrix()
    expect(screen.queryByRole('button', { name: 'Store EBITDA' })).toBeNull()
  })
  test('a subtotal row and a total column are in heavier type', () => {
    matrix()
    expect(cell('ebitda', 'hil').className).toMatch(/font-semibold/)
    expect(cell('manpower', 'all').className).toMatch(/font-semibold/)
    expect(cell('manpower', 'hil').className).not.toMatch(/font-semibold/)
  })
  test('a cell is a link where the caller gives it one', () => {
    matrix({ cellHref: (row, column) => (row.id === 'manpower' && column.id === 'hil' ? '#drill' : undefined) })
    expect(within(cell('manpower', 'hil')).getByRole('link', { name: 'Manpower Cost, Hilltop: 18.40' }).getAttribute('href')).toBe('#drill')
    expect(within(cell('manpower', 'lak')).queryByRole('link')).toBeNull()
  })
  test('someone who may change a cell types the new figure and it is handed back; Escape leaves it', () => {
    const onEdit = vi.fn()
    matrix({ onEdit, editable: (row, column) => !row.strong && !column.total, parse: text => Number(text) })
    expect(within(cell('ebitda', 'hil')).queryByRole('button')).toBeNull()
    expect(within(cell('manpower', 'all')).queryByRole('button')).toBeNull()
    fireEvent.click(within(cell('credit', 'hil')).getByRole('button', { name: 'Change Charge To Gold House, Hilltop: -0.53' }))
    const input = screen.getByRole('textbox', { name: 'Charge To Gold House, Hilltop' })
    fireEvent.change(input, { target: { value: '61000' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'credit' }), expect.objectContaining({ id: 'hil' }), 61000)
    fireEvent.click(within(cell('credit', 'hil')).getByRole('button'))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
  test('a figure that is not a number is not handed back, and the box says so', () => {
    const onEdit = vi.fn()
    matrix({ onEdit, editable: () => true, parse: text => (text === 'abc' ? null : Number(text)) })
    fireEvent.click(within(cell('credit', 'hil')).getByRole('button'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onEdit).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })
  test('with no rows it says what the caller gives it to say', () => {
    render(<FigureMatrix label="Empty" rowHeading="Line" columns={COLUMNS} rows={[]} empty="No budget for this month." />)
    expect(screen.getByText('No budget for this month.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
