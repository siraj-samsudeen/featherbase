import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { BandedTable, type BandedBand, type BandedColumn, type BandedGroup } from './BandedTable'
import { Button } from './Button'
import { TextInput } from './Field'
import { fmtCount } from './format'

// Made-up reorder lines for a shop.
interface Line { id: string; category: string; item: string; sold: number; returned: number; suggested: number; planned: number | null }
const LINES: Line[] = [
  { id: 'RL-1', category: 'Stationery', item: 'Notebook A5', sold: 820, returned: 11, suggested: 760, planned: 760 },
  { id: 'RL-2', category: 'Stationery', item: 'Gel Pen', sold: 690, returned: 19, suggested: 640, planned: null },
  { id: 'RL-3', category: 'Snacks', item: 'Salted Crisps', sold: 3_100, returned: 54, suggested: 3_300, planned: null },
  { id: 'RL-4', category: 'Snacks', item: 'Fruit Bar', sold: 2_110, returned: 42, suggested: 2_300, planned: 2_300 },
]
const COLUMNS: BandedColumn[] = [
  { key: 'item', header: 'Category' },
  { key: 'sold', header: 'Sold', align: 'end' },
  { key: 'returned', header: 'Returned', align: 'end' },
  { key: 'suggested', header: 'Suggested', align: 'end' },
  { key: 'planned', header: 'Planned', align: 'end' },
]
const BANDS: BandedBand[] = [
  { label: 'Last Month', columns: ['sold', 'returned'] },
  { label: 'Next Month', columns: ['suggested', 'planned'] },
]
const FIGURES = ['sold', 'returned', 'suggested', 'planned'] as const
const cell = (line: Line, column: BandedColumn) => {
  const value = line[column.key as keyof Line]
  return typeof value === 'number' ? fmtCount(value) : value ?? '—'
}
const lineKey = (line: Line) => line.id
const sum = (lines: Line[], key: (typeof FIGURES)[number]) => fmtCount(lines.reduce((total, line) => total + (line[key] ?? 0), 0))
const GROUPS: BandedGroup<Line>[] = ['Stationery', 'Snacks'].map((category) => {
  const rows = LINES.filter((line) => line.category === category)
  return { key: category, name: category, rows, totals: Object.fromEntries(FIGURES.map((key) => [key, sum(rows, key)])) }
})

/** A row's Planned cell as a page draws it: a box and two buttons, far wider than the group's total above it. */
const planCell = (line: Line, column: BandedColumn) => column.key === 'planned'
  ? <span className="flex flex-wrap items-center gap-2"><TextInput aria-label={`Planned for ${line.item}`} className="w-28" defaultValue={line.planned ?? ''} /><Button>Save</Button><Button variant="quiet">Accept Suggested</Button></span>
  : cell(line, column)

function Grouped({ bands, controls = false }: { bands?: BandedBand[]; controls?: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  return <BandedTable caption="Reorder plan" columns={COLUMNS} bands={bands} groups={GROUPS} openGroup={open} onOpenGroup={setOpen} cell={controls ? planCell : cell} rowKey={lineKey} />
}

/**
 * A table in the list view's look for a screen drawn from data (a runtime page). `bands` adds a second
 * header row: each label spans exactly its own columns, and a column in no band has an empty cell above
 * it. `groups` in place of `rows` draws one row per group (its name, how many rows it holds, a total under
 * each column that has one); the open group's rows show directly under it, and the caller holds which
 * group is open. `align: "end"` is for figures. Every record a cell names is a RecordLink, which the
 * caller's `cell` draws. A metadata Table uses the Admin list view instead; a hand-built list that turns
 * into cards on a phone uses DataList.
 */
const meta = {
  title: 'Shop floor/BandedTable',
  component: BandedTable,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof BandedTable>
export default meta
// Generic over its rows; each story renders its own.
type Story = StoryObj

const region = (canvasElement: HTMLElement) => within(canvasElement).getByRole('region')
const box = (element: Element) => element.getBoundingClientRect()

export const PlainRows: Story = {
  render: () => <BandedTable caption="Reorder plan" columns={COLUMNS} rows={LINES} cell={cell} rowKey={lineKey} />,
  play: async ({ canvasElement }) => {
    const scroller = region(canvasElement)
    await expect(within(scroller).getAllByRole('row')).toHaveLength(LINES.length + 1)
    await expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)
    // A figure ends where its header ends.
    const header = within(scroller).getByRole('columnheader', { name: 'Sold' })
    const figure = within(within(scroller).getByRole('row', { name: /Notebook A5/ })).getByText('820')
    await expect(Math.round(box(figure).right)).toBe(Math.round(box(header).right))
  },
}

export const Bands: Story = {
  name: 'Bands over columns',
  render: () => <BandedTable caption="Reorder plan" columns={COLUMNS} bands={BANDS} rows={LINES} cell={cell} rowKey={lineKey} />,
  play: async ({ canvasElement }) => {
    const table = within(region(canvasElement))
    const band = table.getByRole('columnheader', { name: 'Last Month' })
    // The band spans exactly its own columns.
    await expect(Math.round(box(band).left)).toBe(Math.round(box(table.getByRole('columnheader', { name: 'Sold' })).left))
    await expect(Math.round(box(band).right)).toBe(Math.round(box(table.getByRole('columnheader', { name: 'Returned' })).right))
    // The column in no band has an empty cell above it.
    const empty = canvasElement.querySelector('[data-band-row] > td')!
    await expect(empty.textContent).toBe('')
    await expect(Math.round(box(empty).right)).toBe(Math.round(box(table.getByRole('columnheader', { name: 'Category' })).right))
  },
}

export const GroupsThatOpen: Story = {
  name: 'Groups that open in place',
  render: () => <Grouped bands={BANDS} />,
  play: async ({ canvasElement }) => {
    const table = within(region(canvasElement))
    await expect(table.queryByText('Notebook A5')).toBeNull()
    await expect(within(table.getByRole('row', { name: /Stationery/ })).getByText('1,510')).toBeVisible()
    await userEvent.click(table.getByRole('button', { name: 'Stationery' }))
    await expect(table.getByRole('button', { name: 'Stationery' })).toHaveAttribute('aria-expanded', 'true')
    // Its rows sit directly under it, above the next group.
    const top = (name: RegExp) => box(table.getByRole('row', { name })).top
    await expect(top(/Notebook A5/)).toBeGreaterThan(top(/Stationery/))
    await expect(top(/Gel Pen/)).toBeLessThan(top(/Snacks/))
    // Opening another closes the first.
    await userEvent.click(table.getByRole('button', { name: 'Snacks' }))
    await expect(table.queryByText('Notebook A5')).toBeNull()
    await expect(table.getByText('Fruit Bar')).toBeVisible()
  },
}

export const ColumnsHoldStill: Story = {
  name: 'Columns keep their widths when a group opens',
  render: () => <Grouped bands={BANDS} controls />,
  play: async ({ canvasElement }) => {
    const scroller = region(canvasElement)
    const table = within(scroller)
    const edges = () => table.getAllByRole('columnheader').map((header) => [header.textContent, Math.round(box(header).left), Math.round(box(header).right)])
    const closed = edges()
    await userEvent.click(table.getByRole('button', { name: 'Stationery' }))
    await expect(table.getByRole('textbox', { name: 'Planned for Notebook A5' })).toBeVisible()
    // The rows that opened hold wider cells than the group's own row; no column moves for them.
    await expect(edges()).toEqual(closed)
    await userEvent.click(table.getByRole('button', { name: 'Stationery' }))
    await expect(edges()).toEqual(closed)
    await expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)
  },
}

const WIDE: Line[] = [
  { id: 'RL-9', category: 'Stationery', item: 'Hardbound-ruled-notebook-A5-two-hundred-pages-recycled-paper-with-elastic-closure-and-ribbon-marker-pack-of-twelve', sold: 12_34_56_789, returned: 9_87_65_432, suggested: 12_00_00_000, planned: 11_99_99_999 },
]
export const WideValues: Story = {
  name: 'Wide values stay inside the box',
  render: () => <BandedTable caption="Reorder plan" columns={COLUMNS} bands={BANDS} rows={WIDE} cell={cell} rowKey={lineKey} />,
  play: async ({ canvasElement }) => {
    const scroller = region(canvasElement)
    await expect(box(scroller).right).toBeLessThanOrEqual(box(canvasElement).right)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
}
