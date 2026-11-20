import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { FoldToggle } from './FoldToggle'
import { fmtNumber } from './format'
import { TABLE_CLASSES, cellClasses, headCellClasses } from './TableLook'

export interface FigureColumn {
  id: string
  /** What the column is called, read aloud for a cell. */
  label: string
  /** What the heading draws, when it is more than the label (a link to the store). */
  header?: ReactNode
  /** A total of other columns: drawn in heavier type. */
  total?: boolean
}

export interface FigureRow {
  id: string
  label: string
  /** What the row heading draws, when it is more than the label (a link to the line). */
  header?: ReactNode
  /** A figure per column id. null or absent is "no figure", drawn as a dash by the format. */
  values: Record<string, number | null | undefined>
  /** A subtotal: drawn in heavier type. */
  strong?: boolean
  /** A row shown for reference and not added, such as a memo line. */
  quiet?: boolean
  /** The rows that add up to this one. Folded away until the row is opened. */
  children?: FigureRow[]
}

const plain = (x: number | null | undefined) => (x == null ? '—' : fmtNumber(x, 2))

/**
 * Figures as a statement: lines down, columns across (stores, months, versions), every figure
 * right-aligned in tabular figures so the digits line up. A line can fold its working rows
 * under it; a subtotal row and a total column are in heavier type. Rows are told apart by
 * space and the hover tint, never a rule. The first column and the header stay in view while
 * the rest scrolls.
 *
 * The caller works out every figure, subtotals included: this draws them. Give `cellHref`
 * for a figure that opens what is behind it, and `onEdit` with `editable` for one a person
 * may change in place.
 */
export function FigureMatrix({ label, rowHeading, columns, rows, format = plain, cellHref, editable, onEdit, parse = Number, empty, className }: {
  label: string
  rowHeading: string
  columns: FigureColumn[]
  rows: FigureRow[]
  format?: (value: number | null | undefined) => string
  cellHref?: (row: FigureRow, column: FigureColumn) => string | undefined
  editable?: (row: FigureRow, column: FigureColumn) => boolean
  onEdit?: (row: FigureRow, column: FigureColumn, value: number) => void
  /** What the typed text means as a number; null when it is not one. */
  parse?: (text: string) => number | null
  /** What to say when there are no rows. */
  empty?: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState<{ key: string; text: string; invalid: boolean } | null>(null)
  // Many columns (a year of months and its total) are drawn tighter so they fit the page without scrolling sideways.
  const dense = columns.length > 9
  const tight = dense && 'px-1.5! text-xs!'
  if (!rows.length) return empty ? <p className="text-sm text-ink-subtle">{empty}</p> : null

  const toggle = (id: string) => setOpen((was) => {
    const next = new Set(was)
    if (!next.delete(id)) next.add(id)
    return next
  })

  function figure(row: FigureRow, column: FigureColumn) {
    const key = `${row.id}|${column.id}`
    const text = format(row.values[column.id])
    const name = `${row.label}, ${column.label}`
    if (editing?.key === key) {
      const commit = () => {
        const value = parse(editing.text.trim())
        if (value === null || Number.isNaN(value)) return setEditing({ ...editing, invalid: true })
        setEditing(null)
        onEdit!(row, column, value)
      }
      const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') setEditing(null)
      }
      return <input autoFocus aria-label={name} aria-invalid={editing.invalid || undefined} title={editing.invalid ? 'Type a number' : undefined} value={editing.text} inputMode="decimal"
        onChange={event => setEditing({ key, text: event.target.value, invalid: false })} onKeyDown={onKeyDown} onBlur={() => setEditing(null)}
        className="h-7 w-28 rounded-control bg-fill px-2 text-right tabular-nums outline-2 outline-focus aria-invalid:outline-negative" />
    }
    if (onEdit && editable?.(row, column))
      return <button type="button" aria-label={`Change ${name}: ${text}`} onClick={() => setEditing({ key, text: row.values[column.id] == null ? '' : String(row.values[column.id]), invalid: false })}
        className="-mx-2 min-h-7 rounded-control px-2 tabular-nums hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus">{text}</button>
    const href = cellHref?.(row, column)
    if (href) return <a href={href} aria-label={`${name}: ${text}`} className="text-ink hover:text-action hover:underline">{text}</a>
    return text
  }

  function draw(row: FigureRow, depth: number): ReactNode {
    const folds = !!row.children?.length
    const isOpen = open.has(row.id)
    return [
      <tr key={row.id} className="group">
        <th scope="row" className={cellClasses({ density: 'compact', first: true,
          className: cx('sticky left-0 z-10 bg-surface text-left font-normal whitespace-nowrap group-even:bg-subtle', row.strong && 'font-semibold', (row.quiet || depth > 0) && 'text-ink-subtle',
            dense && 'max-w-44 overflow-hidden text-ellipsis text-xs!') })}
          title={dense ? row.label : undefined} style={depth ? { paddingLeft: 12 + depth * 20 } : undefined}>
          {folds
            ? <span className="inline-flex items-center gap-1">{row.header
                ? <><FoldToggle open={isOpen} onToggle={() => toggle(row.id)} label={row.label} />{row.header}</>
                : <FoldToggle open={isOpen} onToggle={() => toggle(row.id)}>{row.label}</FoldToggle>}</span>
            : <span className={cx(depth === 0 && 'pl-[18px]')}>{row.header ?? row.label}</span>}
        </th>
        {columns.map((column, index) => (
          <td key={column.id} data-testid={`figure-${row.id}-${column.id}`}
            className={cellClasses({ density: 'compact', last: index === columns.length - 1,
              className: cx('text-right tabular-nums whitespace-nowrap', tight, (row.strong || column.total) && 'font-semibold', (row.quiet || depth > 0) && 'text-ink-subtle') })}>
            {figure(row, column)}
          </td>
        ))}
      </tr>,
      ...(folds && isOpen ? row.children!.map(child => draw(child, depth + 1)) : []),
    ]
  }

  return (
    <div className={cx('max-w-full overflow-auto', className)}>
      <table aria-label={label} data-dense={dense || undefined} className={TABLE_CLASSES}>
        <thead className="sticky top-0 z-20">
          <tr>
            <th scope="col" className={headCellClasses({ first: true, className: 'sticky left-0 z-10 pl-[30px]' })}>{rowHeading}</th>
            {columns.map((column, index) => (
              <th key={column.id} scope="col" className={headCellClasses({ last: index === columns.length - 1, className: cx('text-right', tight, column.total && 'font-semibold text-ink') })}>{column.header ?? column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(row => draw(row, 0))}</tbody>
      </table>
    </div>
  )
}
