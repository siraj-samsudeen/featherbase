// BandedTable (#1410): a table in the list view's look with bands over its
// columns and groups of rows that open in place. Pure component tests: no
// server, no database. Made-up data: a shop's reorder lines.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { BandedTable, type BandedColumn, type BandedGroup } from '@featherbase/shop-floor'

interface Line { id: string; item: string; sold: number; returned: number; suggested: number }
const LINES: Line[] = [
  { id: 'RL-1', item: 'Notebook A5', sold: 820, returned: 11, suggested: 760 },
  { id: 'RL-2', item: 'Gel Pen', sold: 690, returned: 19, suggested: 640 },
]
const COLUMNS: BandedColumn[] = [
  { key: 'item', header: 'Item' },
  { key: 'sold', header: 'Sold', align: 'end' },
  { key: 'returned', header: 'Returned', align: 'end' },
  { key: 'suggested', header: 'Suggested', align: 'end' },
]
const cell = (line: Line, column: BandedColumn) => String(line[column.key as keyof Line])
const lineKey = (line: Line) => line.id

describe('plain rows', () => {
  test('a header row heads each column, and each row shows its cells', () => {
    render(<BandedTable caption="Reorder plan" columns={COLUMNS} rows={LINES} cell={cell} rowKey={lineKey} />)
    const table = screen.getByRole('table', { name: 'Reorder plan' })
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Item', 'Sold', 'Returned', 'Suggested'])
    const row = within(table).getByRole('row', { name: /Notebook A5/ })
    expect(within(row).getAllByRole('cell').map((td) => td.textContent)).toEqual(['820', '11', '760'])
  })

  test('a row carries its key, so one row can be told from another', () => {
    render(<BandedTable caption="Reorder plan" columns={COLUMNS} rows={LINES} cell={cell} rowKey={lineKey} />)
    expect(screen.getByRole('row', { name: /Gel Pen/ })).toHaveAttribute('data-row', 'RL-2')
  })

  test('with no rows the table says so under its header', () => {
    render(<BandedTable caption="Reorder plan" columns={COLUMNS} rows={[]} cell={cell} rowKey={lineKey} />)
    const empty = within(screen.getAllByRole('row')[1]!).getByRole('cell')
    expect([empty.textContent, empty.getAttribute('colspan')]).toEqual(['Nothing to show', '4'])
  })
})

describe('figures', () => {
  test('a column aligned to the end is right-aligned with tabular numerals, header and cells alike', () => {
    render(<BandedTable caption="Reorder plan" columns={COLUMNS} rows={LINES} cell={cell} rowKey={lineKey} />)
    expect(screen.getByRole('columnheader', { name: 'Sold' }).className).toMatch(/\btext-right\b/)
    const figure = within(screen.getByRole('row', { name: /Notebook A5/ })).getByText('820')
    expect(figure.className).toMatch(/\btext-right\b/)
    expect(figure.className).toMatch(/\btabular-nums\b/)
  })
})

describe('bands', () => {
  const BANDS = [{ label: 'Last Month', columns: ['sold', 'returned'] }, { label: 'Next Month', columns: ['suggested'] }]
  const bandRow = () => screen.getAllByRole('row')[0]!

  test('a band row sits above the header row, each label spanning exactly its own columns', () => {
    render(<BandedTable caption="Reorder plan" columns={COLUMNS} bands={BANDS} rows={LINES} cell={cell} rowKey={lineKey} />)
    const labels = within(bandRow()).getAllByRole('columnheader')
    expect(labels.map((th) => [th.textContent, th.getAttribute('colspan')])).toEqual([['Last Month', '2'], ['Next Month', '1']])
  })

  test('a column in no band has an empty cell above it', () => {
    render(<BandedTable caption="Reorder plan" columns={COLUMNS} bands={BANDS} rows={LINES} cell={cell} rowKey={lineKey} />)
    const first = bandRow().children[0]!
    expect(first.textContent).toBe('')
    expect(first.getAttribute('colspan')).toBeNull()
    expect(bandRow().children).toHaveLength(3)
  })

  test('a band shrinks to the columns that are drawn, and goes when none of them is', () => {
    const shown = COLUMNS.filter((column) => column.key !== 'returned' && column.key !== 'suggested')
    render(<BandedTable caption="Reorder plan" columns={shown} bands={BANDS} rows={LINES} cell={cell} rowKey={lineKey} />)
    expect(within(bandRow()).getAllByRole('columnheader').map((th) => [th.textContent, th.getAttribute('colspan')])).toEqual([['Last Month', '1']])
  })

  test('with no band to draw there is no band row', () => {
    render(<BandedTable caption="Reorder plan" columns={COLUMNS.slice(0, 1)} bands={BANDS} rows={LINES} cell={cell} rowKey={lineKey} />)
    expect(screen.getAllByRole('row')).toHaveLength(1 + LINES.length)
  })
})

describe('groups', () => {
  const GROUPS: BandedGroup<Line>[] = [
    { key: 'Stationery', name: 'Stationery', rows: LINES, totals: { sold: '1,510', suggested: '1,400' } },
    { key: 'Snacks', name: 'Snacks', rows: [{ id: 'RL-3', item: 'Salted Crisps', sold: 300, returned: 4, suggested: 320 }], totals: { sold: '300', suggested: '320' } },
  ]
  const grouped = (open: string | null, onOpenGroup = vi.fn()) =>
    render(<BandedTable caption="Reorder plan" columns={COLUMNS} groups={GROUPS} openGroup={open} onOpenGroup={onOpenGroup} cell={cell} rowKey={lineKey} />)

  test('each group is one row: its name, how many rows it holds, and a total under each column that has one', () => {
    grouped(null)
    const row = screen.getByRole('row', { name: /Stationery/ })
    expect(within(row).getByRole('rowheader')).toHaveTextContent(/^Stationery\s*2$/)
    expect(within(row).getAllByRole('cell').map((td) => td.textContent)).toEqual(['1,510', '', '1,400'])
  })

  test('a group\'s own rows are hidden until it is opened', () => {
    grouped(null)
    expect(screen.getAllByRole('row')).toHaveLength(1 + GROUPS.length)
    expect(screen.queryByText('Notebook A5')).not.toBeInTheDocument()
  })

  test('an open group shows its rows directly under it', () => {
    grouped('Stationery')
    expect(screen.getAllByRole('row').slice(1).map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['Stationery2', 'Notebook A5', 'Gel Pen', 'Snacks1'])
  })

  test('the opener is a button that says whether its group is open', () => {
    grouped('Stationery')
    expect(screen.getByRole('button', { name: 'Stationery' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Snacks' })).toHaveAttribute('aria-expanded', 'false')
  })

  test('pressing a closed group asks to open it', async () => {
    const onOpenGroup = vi.fn()
    grouped('Stationery', onOpenGroup)
    await userEvent.click(screen.getByRole('button', { name: 'Snacks' }))
    expect(onOpenGroup).toHaveBeenCalledWith('Snacks')
  })

  test('pressing the open group asks to close it', async () => {
    const onOpenGroup = vi.fn()
    grouped('Stationery', onOpenGroup)
    await userEvent.click(screen.getByRole('button', { name: 'Stationery' }))
    expect(onOpenGroup).toHaveBeenCalledWith(null)
  })
})
