import { Fragment, type ReactNode } from 'react'
import { cx } from './cx'
import { fmtCount } from './format'
import { ChevronRight } from './icons'
import { cellClasses, headCellClasses, TABLE_CLASSES } from './TableLook'

// #1410: a table for a screen built from data (a runtime page), in the list view's look (TableLook).
// It draws what it is given and knows nothing of where the rows came from.

export interface BandedColumn {
  key: string
  header: ReactNode
  /** `end` for figures: right-aligned, tabular numerals. */
  align?: 'start' | 'end'
}

/** A label over the columns it names, which sit next to each other. */
export interface BandedBand { label: ReactNode; columns: string[] }

/** Rows drawn as one row: the group's name, how many rows it holds, and a total under each column that has one. */
export interface BandedGroup<Row> {
  key: string
  name: string
  rows: Row[]
  /** By column key, as drawn. */
  totals?: Record<string, ReactNode>
}

/** The band row's cells, left to right: a band over the columns of it that are drawn, or nothing over a column in no band. */
function bandCells(columns: BandedColumn[], bands: BandedBand[]): { key: string; label?: ReactNode; span: number }[] {
  const cells: { key: string; label?: ReactNode; span: number; band?: BandedBand }[] = []
  for (const column of columns) {
    const band = bands.find((each) => each.columns.includes(column.key))
    const before = cells[cells.length - 1]
    if (band && before?.band === band) before.span++
    else cells.push({ key: column.key, label: band?.label, span: 1, band })
  }
  return cells
}

export function BandedTable<Row>({ caption, columns, bands = [], rows = [], groups, openGroup = null, onOpenGroup, cell, rowKey, empty = 'Nothing to show', className }: {
  /** Names the table for assistive tech. */
  caption: string
  columns: BandedColumn[]
  /** A second header row above the first. A band spans the columns of it that are drawn; a column in no band has an empty cell above it. */
  bands?: BandedBand[]
  rows?: Row[]
  /** In place of `rows`: one row per group. The open group's own rows show directly under it. */
  groups?: BandedGroup<Row>[]
  /** The key of the one open group. */
  openGroup?: string | null
  /** Asked to open a group, or with null to close the open one. */
  onOpenGroup?: (key: string | null) => void
  /** What a row shows in a column. */
  cell: (row: Row, column: BandedColumn) => ReactNode
  rowKey: (row: Row) => string
  /** What the table says under its header when it has no rows. */
  empty?: ReactNode
  className?: string
}) {
  const last = columns.length - 1
  const banded = bandCells(columns, bands)
  const hasBands = banded.some((each) => each.label !== undefined)
  // Two header rows are one band of fill: the upper row rounds the top corners, the lower the bottom ones.
  const corners = (first: boolean, end: boolean, upper: boolean) =>
    hasBands ? cx(first && (upper ? 'rounded-tl-lg' : 'rounded-bl-lg'), end && (upper ? 'rounded-tr-lg' : 'rounded-br-lg')) : cx(first && 'rounded-l-lg', end && 'rounded-r-lg')
  const bodyCell = (i: number, column: BandedColumn, more?: string) =>
    cellClasses({ first: i === 0, last: i === last, className: cx('text-ink wrap-break-word [&_*]:wrap-break-word', column.align === 'end' && 'text-right tabular-nums', i === 0 && 'text-left font-medium', more) })
  const dataRow = (row: Row, indent?: string) => (
    <tr key={rowKey(row)} className="group" data-row={rowKey(row)}>
      {columns.map((column, i) => i === 0
        // The first cell names its row for screen readers.
        ? <th key={column.key} scope="row" className={bodyCell(i, column, indent)}>{cell(row, column)}</th>
        : <td key={column.key} className={bodyCell(i, column)}>{cell(row, column)}</td>)}
    </tr>
  )
  return (
    // Focusable and named, so a keyboard can scroll a table wider than its box.
    <div role="region" aria-label={caption} tabIndex={0} className={cx('overflow-x-auto focus-visible:outline-2 focus-visible:outline-focus', className)}>
      <table className={cx(TABLE_CLASSES, 'text-control')}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          {hasBands && (
            <tr data-band-row>
              {banded.map((band, i) => {
                const look = headCellClasses({ className: corners(i === 0, i === banded.length - 1, true) })
                return band.label === undefined
                  ? <td key={band.key} className={look} />
                  : (
                    <th key={band.key} scope="colgroup" colSpan={band.span} data-band={band.key} className={look}>
                      {/* A fill as wide as the band, never a line, shows where it starts and ends. */}
                      <span className="block rounded-md bg-tag px-2 py-0.5 text-center text-tag-ink">{band.label}</span>
                    </th>
                  )
              })}
            </tr>
          )}
          <tr>
            {columns.map((column, i) => (
              <th key={column.key} scope="col" data-column={column.key}
                className={headCellClasses({ className: cx(column.align === 'end' && 'text-right', corners(i === 0, i === last, false)) })}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups ? groups.map((group) => {
            const open = group.key === openGroup
            return (
              <Fragment key={group.key}>
                <tr className="group" data-group={group.key}>
                  {columns.map((column, i) => i === 0
                    ? (
                      <th key={column.key} scope="row" className={bodyCell(i, column)}>
                        <span className="inline-flex items-center gap-2">
                          <button type="button" aria-expanded={open} onClick={() => onOpenGroup?.(open ? null : group.key)}
                            className="-ml-1.5 inline-flex min-h-8 items-center gap-1.5 rounded-control px-1.5 text-left font-semibold text-ink hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-control">
                            <ChevronRight aria-hidden size={16} className={cx('shrink-0 text-ink-subtle transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
                            {group.name}
                          </button>
                          <span className="text-[13px] font-normal text-ink-subtle tabular-nums" data-testid="group-count">{fmtCount(group.rows.length)}</span>
                        </span>
                      </th>
                    )
                    : <td key={column.key} className={bodyCell(i, column, 'font-semibold')}>{group.totals?.[column.key]}</td>)}
                </tr>
                {open && group.rows.map((row) => dataRow(row, 'pl-10'))}
              </Fragment>
            )
          }) : rows.map((row) => dataRow(row))}
          {(groups ?? rows).length === 0 && (
            <tr><td colSpan={columns.length} className={cellClasses({ className: 'text-ink-subtle' })}>{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
