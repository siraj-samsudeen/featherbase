import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { FigureMatrix, type FigureColumn, type FigureRow } from './FigureMatrix'
import { fmtLakhs } from './format'

// Made-up stores and figures, in rupees.
const COLUMNS: FigureColumn[] = [{ id: 'hil', label: 'Hilltop' }, { id: 'lak', label: 'Lakeside' }, { id: 'riv', label: 'Riverside' }, { id: 'all', label: 'North', total: true }]
const ROWS: FigureRow[] = [
  { id: 'net_sales', label: 'Net Sales', quiet: true, values: { hil: 41200000, lak: 22800000, riv: 30500000, all: 94500000 } },
  { id: 'scan_margin', label: 'Scan Margin', values: { hil: 10300000, lak: 5470000, riv: 7620000, all: 23390000 } },
  { id: 'shrinkage', label: 'Shrinkage', values: { hil: 206000, lak: 114000, riv: 152000, all: 472000 } },
  { id: 'net_margin', label: 'Net Margin', strong: true, values: { hil: 10094000, lak: 5356000, riv: 7468000, all: 22918000 } },
  { id: 'manpower', label: 'Manpower Cost', values: { hil: 1840000, lak: 900000, riv: 1320000, all: 4060000 }, children: [
    { id: 'salaries', label: 'Salaries', values: { hil: 1700000, lak: 820000, riv: 1210000, all: 3730000 } },
    { id: 'pf', label: 'PF', values: { hil: 140000, lak: 80000, riv: 110000, all: 330000 } },
  ] },
  { id: 'occupancy', label: 'Occupancy', values: { hil: 980000, lak: null, riv: 760000, all: 1740000 } },
  { id: 'ebitda', label: 'Store EBITDA', strong: true, values: { hil: 7274000, lak: 4456000, riv: 5388000, all: 17118000 } },
]

/**
 * Figures as a statement: lines down and stores, months or versions across. Use it wherever people compare
 * figures down and across and expect subtotals, as in a P&L or a budget. The caller works out every figure;
 * this draws them, right-aligned in tabular figures.
 *
 * - A row with `children` folds them under it.
 * - `strong` marks a subtotal row and `total` a total column: heavier type, no rule.
 * - `quiet` marks a row shown for reference and not added.
 * - `cellHref` makes a figure a link to what is behind it.
 * - `onEdit` with `editable` lets a person change a figure in place: Enter saves, Escape leaves it.
 *
 * Say the unit once, in the page's heading ("₹ lakhs"), and pass a `format` such as `fmtLakhs`. For a list
 * of records with a few number columns, use `DataList`.
 */
const meta = {
  title: 'Shop floor/FigureMatrix',
  component: FigureMatrix,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { label: 'P&L by store, Oct\'26, ₹ lakhs', rowHeading: 'Line', columns: COLUMNS, rows: ROWS, format: fmtLakhs },
} satisfies Meta<typeof FigureMatrix>
export default meta
type Story = StoryObj<typeof meta>

export const Statement: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Manpower Cost' }))
    await expect(canvas.getByText('Salaries')).toBeVisible()
  },
}

export const FiguresThatOpen: Story = { args: { cellHref: (row, column) => (row.children || row.strong || column.total ? undefined : `#${row.id}-${column.id}`) } }

function Editable() {
  const [rows, setRows] = useState(ROWS)
  return <FigureMatrix label="Budget, Oct'26, ₹" rowHeading="Line" columns={COLUMNS} rows={rows}
    editable={(row, column) => !row.strong && !row.children && !column.total}
    onEdit={(row, column, value) => setRows(was => was.map(r => (r.id === row.id ? { ...r, values: { ...r.values, [column.id]: value } } : r)))} />
}
export const ChangedInPlace: Story = { render: () => <Editable /> }

export const Empty: Story = { args: { rows: [], empty: 'No budget covers this month.' } }
