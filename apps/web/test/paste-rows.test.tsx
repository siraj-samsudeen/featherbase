// #1380: PasteRows (shared, shop-floor): cells copied from Excel go into a box, come back as a
// checked table with each problem said on its row, and are saved only when every row is good.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { PasteRows, pastedCells, type PasteCheck } from '@featherbase/shop-floor'

afterEach(cleanup)

// The caller's rule: Store and Amount; an amount must be a number.
const check: PasteCheck = (cells) => {
  if (cells[0]?.[0] !== 'Store') return { headings: cells[0] ?? [], rows: [], problem: 'The first row needs the headings Store, Amount' }
  return { headings: cells[0], rows: cells.slice(1).map(row => ({ cells: row, ...(Number.isNaN(Number(row[1])) ? { problem: `Amount is not a number: ${row[1]}` } : {}) })) }
}
const paste = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Budget lines' }), { target: { value: text } })
function box(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(<PasteRows label="Budget lines" hint="Copy Store and Amount from Excel, headings included." check={check} onSave={onSave} noun="amount" />)
  return { onSave }
}

describe('pastedCells', () => {
  test('splits rows and tab-separated cells, trims them and drops blank rows', () => {
    expect(pastedCells('Store\tAmount \r\n\r\nHilltop\t18\n')).toEqual([['Store', 'Amount'], ['Hilltop', '18']])
  })
})

describe('PasteRows', () => {
  test('starts as a box with its hint and nothing to save', () => {
    box()
    expect(screen.getByText('Copy Store and Amount from Excel, headings included.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull()
  })
  test('shows what was pasted as a table under its own headings and says how many rows are ready', () => {
    box()
    paste('Store\tAmount\nHilltop\t18\nLakeside\t9')
    const table = screen.getByRole('table', { name: 'Budget lines, as pasted' })
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Row', 'Store', 'Amount'])
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('status').textContent).toBe('2 rows ready.')
    expect(screen.getByRole('button', { name: 'Save 2 Amounts' })).toHaveProperty('disabled', false)
  })
  test('says each problem on its row, counts them, and will not save', () => {
    box()
    paste('Store\tAmount\nHilltop\t18\nLakeside\tabc')
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Row', 'Store', 'Amount', 'Problem'])
    expect(within(within(table).getAllByRole('row')[2]).getByText('Amount is not a number: abc')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('1 of 2 rows needs fixing. Correct it in the sheet and paste again; nothing is saved until every row is good.')
    expect(screen.getByRole('button', { name: 'Save 2 Amounts' })).toHaveProperty('disabled', true)
  })
  test('says a problem with the whole paste in place of the table', () => {
    box()
    paste('Shop\tAmount\nHilltop\t18')
    expect(screen.getByRole('alert').textContent).toBe('The first row needs the headings Store, Amount')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull()
  })
  test('saving hands back the checked rows, then empties the box and says it is saved', async () => {
    const { onSave } = box()
    paste('Store\tAmount\nHilltop\t18')
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 Amount' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved 1 amount.'))
    expect(onSave).toHaveBeenCalledWith([{ cells: ['Hilltop', '18'] }])
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByRole('table')).toBeNull()
  })
  test('a save that fails says why and keeps what was pasted', async () => {
    box(vi.fn().mockRejectedValue(new Error('This version is approved')))
    paste('Store\tAmount\nHilltop\t18')
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 Amount' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This version is approved'))
    expect(screen.getByRole('table')).toBeTruthy()
  })
})
