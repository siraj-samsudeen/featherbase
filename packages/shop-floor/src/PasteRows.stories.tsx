import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { PasteRows, type PasteCheck } from './PasteRows'

const STORES = ['Hilltop', 'Lakeside', 'Riverside']
// A caller's rule: Store and Amount, a store it knows and an amount that is a number.
const check: PasteCheck = (cells) => {
  if (cells[0]?.[0] !== 'Store' || cells[0]?.[1] !== 'Amount') return { headings: cells[0] ?? [], rows: [], problem: 'The first row needs the headings Store, Amount' }
  return { headings: cells[0], rows: cells.slice(1).map(row => ({ cells: row,
    ...(!STORES.includes(row[0]) ? { problem: `No store is called ${row[0]}` } : Number.isNaN(Number(row[1])) ? { problem: `Amount is not a number: ${row[1]}` } : {}) })) }
}

/**
 * Bringing rows in from a spreadsheet. The person copies cells in Excel, headings included, and pastes them
 * into the box; what they pasted comes back as a table with each row's problem said on that row. Nothing is
 * saved until every row is good, so a sheet is never half in.
 *
 * The caller supplies `check` (what the cells mean, and what is wrong with a row, in plain words) and `onSave`.
 * Use it for a month of lines or a block of figures. For one row, use a form.
 */
const meta = {
  title: 'Shop floor/PasteRows',
  component: PasteRows,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { label: 'Budget lines', hint: 'Copy Store and Amount from Excel, headings included, and paste here.', check, noun: 'amount', onSave: async () => undefined },
} satisfies Meta<typeof PasteRows>
export default meta
type Story = StoryObj<typeof meta>

export const Waiting: Story = {}

export const EveryRowGood: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('textbox', { name: 'Budget lines' }))
    await userEvent.paste('Store\tAmount\nHilltop\t1840000\nLakeside\t900000')
    await expect(canvas.getByRole('button', { name: 'Save 2 Amounts' })).toBeEnabled()
  },
}

export const ARowToFix: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('textbox', { name: 'Budget lines' }))
    await userEvent.paste('Store\tAmount\nHilltop\t1840000\nHarbour Road\t900000')
    await expect(canvas.getByText('No store is called Harbour Road')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Save 2 Amounts' })).toBeDisabled()
  },
}
