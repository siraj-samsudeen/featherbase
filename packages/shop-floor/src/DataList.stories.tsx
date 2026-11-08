import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Button } from './Button'
import { DataCards, DataList, type DataColumn } from './DataList'
import { fmtCount, fmtINR, fmtPct } from './format'
import { achievementTone } from './Headline'
import { StatusPill } from './StatusPill'

// Made-up sales figures for the sections of one store.
interface Line {
  name: string
  target: number
  sales: number
}
const LINES: Line[] = [
  { name: 'Men Casual Shirt', target: 1_62_000, sales: 1_21_000 },
  { name: 'Men T Shirt', target: 93_000, sales: 58_000 },
  { name: 'Men Formal Shirt', target: 1_38_000, sales: 1_42_000 },
]
const SECTIONS = ['Saree', 'Churidar', 'Kurti', 'Dhoti', 'Kids Wear', 'Men Jeans', 'Footwear', 'Innerwear', 'Bed Linen', 'Towels', 'Western Wear', 'Ethnic Jewellery']
const MANY: Line[] = SECTIONS.flatMap((s, i) => [
  { name: `${s}`, target: 80_000 + i * 9_000, sales: 60_000 + i * 11_000 },
  { name: `${s} (festive)`, target: 40_000 + i * 3_000, sales: 45_000 + i * 2_000 },
])
const pct = (l: Line) => (l.sales / l.target) * 100
const lineKey = (l: Line) => l.name

const COLUMNS: DataColumn<Line>[] = [
  { key: 'name', header: 'Subcategory', cell: (l) => l.name, phone: 'title' },
  {
    key: 'ach',
    header: 'Achievement',
    align: 'end',
    phone: 'status',
    cell: (l) => <StatusPill tone={achievementTone(pct(l))}>{fmtPct(Math.round(pct(l) * 10) / 10)}</StatusPill>,
  },
  { key: 'target', header: 'Target', align: 'end', cell: (l) => fmtINR(l.target) },
  { key: 'sales', header: 'Sales', align: 'end', cell: (l) => fmtINR(l.sales) },
  { key: 'gap', header: 'Gap', align: 'end', cell: (l) => fmtINR(l.sales - l.target, { signed: true }) },
  { key: 'qty', header: 'Pieces', align: 'end', phone: 'hidden', cell: (l) => fmtCount(Math.round(l.sales / 450)) },
]

const LONG_COLUMNS: DataColumn<Line>[] = [
  ...COLUMNS.slice(0, 1),
  { key: 'status', header: 'Status', phone: 'status', cell: () => <StatusPill tone="caution">Awaiting second-level approval from the regional office</StatusPill> },
  { key: 'meta', header: 'Reference', phone: 'meta', cell: () => 'https://example.invalid/a/very/long/reference/path/without/any/spaces/at/all' },
  { key: 'v', header: 'AVeryLongMetadataDerivedColumnHeaderWithoutSpaces', cell: (l) => fmtINR(l.sales) },
]
const LONG_ROWS: Line[] = [{ name: 'SKU-0123456789012345678901234567890123456789-SAREE-KANCHIPURAM', target: 1_62_000, sales: 1_21_000 }]

const EMPTY = { title: 'No targets this month', body: 'Targets appear here once they are set for your Sections.' }

const meta = {
  title: 'Shop floor/DataList',
  component: DataList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A list of rows for a screen built by hand (a report, a dashboard section): a table on a wide screen and one card per row on a ' +
          "phone, so a phone never scrolls sideways. Each column's `phone` role places it on the card (`title`, `status`, `meta`, `value`, " +
          '`hidden`); `align: "end"` for numbers. `state` covers `loading` (a Skeleton), `error` (a Notice with "Try again" from `onRetry`) ' +
          'and an empty list (the `empty` EmptyState). Metadata Tables use the Admin list view instead. `DataCards` is the phone shape on its ' +
          'own, with optional row selection and expansion.',
      },
    },
  },
} satisfies Meta<typeof DataList>
export default meta
// Each story renders its own rows: the list is generic over them.
type Story = StoryObj

/** The region a wide list scrolls in, when it has to. */
const region = (canvasElement: HTMLElement) => within(canvasElement).getByRole('region')

export const Table: Story = {
  name: 'Table (a wide screen)',
  render: () => <DataList caption="Where the gap is" rows={LINES} columns={COLUMNS} rowKey={lineKey} empty={EMPTY} />,
  play: async ({ canvasElement }) => {
    const box = region(canvasElement)
    await expect(within(box).getAllByRole('row')).toHaveLength(LINES.length + 1)
    await expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
  },
}

export const Cards: Story = {
  name: 'Cards (the phone shape)',
  render: () => <div className="max-w-sm"><DataList caption="Where the gap is" layout="cards" rows={LINES} columns={COLUMNS} rowKey={lineKey} empty={EMPTY} /></div>,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('list', { name: 'Where the gap is' }).children).toHaveLength(LINES.length)
  },
}

export const Loading: Story = {
  render: () => <DataList caption="Where the gap is" state="loading" rows={[]} columns={COLUMNS} rowKey={lineKey} empty={EMPTY} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Loading where the gap is')
  },
}

const retry = fn()
export const Failed: Story = {
  render: () => <DataList caption="Where the gap is" state="error" onRetry={retry} rows={[]} columns={COLUMNS} rowKey={lineKey} empty={EMPTY} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('Cannot load where the gap is')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(retry).toHaveBeenCalled()
  },
}

export const Empty: Story = {
  render: () => <DataList caption="Where the gap is" rows={[] as Line[]} columns={COLUMNS} rowKey={lineKey} empty={EMPTY} />,
}

export const EmptyWithAction: Story = {
  render: () => (
    <DataList caption="Checklist runs" rows={[] as Line[]} columns={COLUMNS} rowKey={lineKey}
      empty={{ title: 'No checklists yet', body: 'Runs you start appear here.', action: <Button variant="primary">Start a checklist</Button> }} />
  ),
}

export const ManyRows: Story = {
  render: () => <DataList caption="Every section of 1501 Attakulangara" rows={MANY} columns={COLUMNS} rowKey={lineKey} empty={EMPTY} />,
  play: async ({ canvasElement }) => {
    const box = region(canvasElement)
    await expect(within(box).getAllByRole('row')).toHaveLength(MANY.length + 1)
    await expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
  },
}

export const LongValuesInATable: Story = {
  name: 'Long values in a table',
  render: () => <DataList caption="Long values" layout="table" rows={LONG_ROWS} columns={LONG_COLUMNS} rowKey={lineKey} empty={EMPTY} />,
}

export const LongValuesInACard: Story = {
  name: 'Long values wrap inside a phone card',
  render: () => <div className="max-w-sm"><DataList caption="Long values" layout="cards" rows={LONG_ROWS} columns={LONG_COLUMNS} rowKey={lineKey} empty={EMPTY} /></div>,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole('listitem')
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
  },
}

/** More than three figures: the card says "N more" and opens the rest in place. */
const WIDE: DataColumn<Line>[] = [
  ...COLUMNS.slice(0, 5),
  { key: 'pieces', header: 'Pieces', align: 'end', cell: (l) => fmtCount(Math.round(l.sales / 450)) },
  { key: 'avg', header: 'Average bill', align: 'end', cell: (l) => fmtINR(Math.round(l.sales / 120)) },
]

function SelectableCards() {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const flip = (set: Set<string>, key: string) => { const next = new Set(set); if (!next.delete(key)) next.add(key); return next }
  return (
    <div className="max-w-sm">
      <DataCards caption="Where the gap is" rows={LINES} columns={WIDE} rowKey={lineKey}
        select={{ isSelected: (l) => picked.has(l.name), onToggle: (l) => setPicked(flip(picked, l.name)), label: (l) => `Select ${l.name}` }}
        expand={{ isExpanded: (l) => open.has(l.name), onToggle: (l) => setOpen(flip(open, l.name)), render: (l) => <p className="text-sm">Brands under {l.name}: Peter England, Allen Solly, Louis Philippe.</p> }} />
    </div>
  )
}

export const CardsSelectAndExpand: Story = {
  name: 'Cards with selection, expansion and N more',
  render: () => <SelectableCards />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [first] = canvas.getAllByRole('listitem')
    const card = within(first)
    await userEvent.click(card.getByRole('checkbox', { name: 'Select Men Casual Shirt' }))
    await expect(card.getByRole('checkbox')).toBeChecked()
    const more = card.getByRole('button', { name: '2 more columns' })
    await userEvent.click(more)
    await expect(card.getByText('Average bill')).toBeVisible()
    await userEvent.click(card.getByRole('button', { name: 'Show nested rows' }))
    await expect(card.getByText(/Brands under Men Casual Shirt/)).toBeVisible()
  },
}
