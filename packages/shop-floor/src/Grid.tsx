import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { cx } from './cx'
import { fmtCount } from './format'
import { cellClasses, headCellClasses } from './TableLook'

// #1282 F1–F6: the Grid: a small pair (both sides at most about 40) as rows × columns, each
// cell stepping through its values. A change waits, outlined, until the app saves it; every
// cell says its sentence on hover. A real table: each header heads exactly its own column.
// The app owns the data, the sentences and the save; this draws and steps.

/** `titleNode`: the title as drawn, where the row is a record (its RecordLink); `title` stays its plain words. */
export interface GridRow { id: string; group?: string; title: string; titleNode?: ReactNode }
export interface GridColumn { id: string; label: string; header: ReactNode }
export interface GridStep { value: string; label: string }

/** Up to this many columns lie flat (wrapping to two lines); more tilt at 45°. */
const FLAT_COLUMNS = 10

export const gridKey = (row: { id: string }, column: { id: string }) => `${row.id}|${column.id}`

/** The value a click moves to: — → the first step → … → the last → —. */
function nextStep(steps: GridStep[], value: string | null): string | null {
  if (value === null) return steps[0]!.value
  const at = steps.findIndex((s) => s.value === value)
  return at + 1 < steps.length ? steps[at + 1]!.value : null
}

export function Grid({ label, rows, columns, steps, saved, waiting, onStep, tooltip, readOnly = false }: {
  label: string
  rows: GridRow[]
  columns: GridColumn[]
  steps: GridStep[]
  /** The value saved now, or null for none (—). */
  saved: (row: GridRow, column: GridColumn) => string | null
  /** The changes waiting, keyed by gridKey: the new value, or null for none. */
  waiting: ReadonlyMap<string, string | null>
  onStep: (row: GridRow, column: GridColumn, next: string | null) => void
  /** The cell's sentence in plain words (a tooltip holds no links). */
  tooltip: (row: GridRow, column: GridColumn, value: string | null) => string
  readOnly?: boolean
}) {
  const tilt = columns.length > FLAT_COLUMNS ? 'tilted' : 'flat'
  // A soft fade at the right edge while columns are hidden past it (UI owner), gone at the end.
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const box = scroller.current!
    const measure = () => setMore(box.scrollLeft + box.clientWidth < box.scrollWidth - 1)
    measure()
    box.addEventListener('scroll', measure)
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resized?.observe(box)
    return () => { box.removeEventListener('scroll', measure); resized?.disconnect() }
  }, [columns.length])
  const labelOf = (value: string | null) => (value === null ? '—' : steps.find((s) => s.value === value)?.label ?? value)
  let lastGroup: string | undefined
  return (
    <div className="relative">
    <div className="overflow-x-auto" ref={scroller} data-testid="grid-scroller">
      <table className="border-separate border-spacing-0 text-sm" aria-label={label} data-testid="grid">
        <thead>
          <tr>
            {/* #1348: the header band is the list view's (TableLook): a quiet fill, rounded ends, no lines. */}
            <th scope="col" data-column="" className={headCellClasses({ first: true, className: 'sticky left-0 z-10' })} />
            {columns.map((column) => (
              <th key={column.id} scope="col" data-column={column.id} data-testid="grid-header" data-tilt={tilt}
                className={headCellClasses({ last: column === columns[columns.length - 1], className: cx('py-2 align-bottom', tilt === 'flat' ? 'w-24 text-center' : 'relative h-44 w-18 min-w-18 max-w-18') })}>
                {tilt === 'flat'
                  ? <span className="line-clamp-2 break-words text-sm leading-tight">{column.header}</span>
                  // Tilted, the label is drawn outside the column's width: a narrow column, its name rising to the right.
                  // Lifted above the band, so the next column's header does not paint over its rising name.
                  : <span className="absolute bottom-2 left-1/2 z-10 origin-bottom-left -rotate-45 whitespace-nowrap text-sm">{column.header}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const group = row.group !== lastGroup ? row.group : undefined
            lastGroup = row.group
            return (
              <Fragment key={row.id}>
                {group && (
                  // The group's name stays in view while the grid scrolls sideways.
                  <tr><td colSpan={columns.length + 1} className="px-3 pt-4 pb-1"><span className="sticky left-3 font-semibold text-ink" data-testid="grid-group">{group}</span></td></tr>
                )}
                <tr className="group">
                  {/* On a phone the title column is narrow and wraps to two lines, so the cells stay in reach (UI owner). */}
                  <td data-column="" className={cellClasses({ first: true, className: 'sticky left-0 bg-surface whitespace-nowrap text-ink-muted max-md:max-w-30 max-md:whitespace-normal' })} data-testid="grid-row-title">
                    <span className="max-md:line-clamp-2">{row.titleNode ?? row.title}</span>
                  </td>
                  {columns.map((column) => {
                    const key = gridKey(row, column)
                    const isWaiting = waiting.has(key)
                    const value = isWaiting ? waiting.get(key)! : saved(row, column)
                    const pill = cx('inline-block min-w-12 rounded-full px-2 py-px text-center text-xs',
                      isWaiting ? 'bg-action-tint text-action outline-2 outline-action' : value === null ? 'text-ink-subtle' : 'bg-tag text-ink-muted')
                    const title = tooltip(row, column, value)
                    return (
                      <td key={column.id} data-column={column.id} data-testid={`grid-cell-${row.id}-${column.id}`} data-waiting={String(isWaiting)} className={cellClasses({ last: column === columns[columns.length - 1], className: 'text-center' })}>
                        {readOnly
                          ? <span className={pill} title={title}>{labelOf(value)}</span>
                          : (
                            <button type="button" className={cx(pill, 'cursor-pointer hover:outline-1 hover:outline-border-control focus-visible:outline-2 focus-visible:outline-focus')}
                              title={title} aria-label={title} onClick={() => onStep(row, column, nextStep(steps, value))}>
                              {labelOf(value)}
                            </button>
                          )}
                      </td>
                    )
                  })}
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
    {more && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-surface to-transparent" data-testid="grid-more" />}
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${fmtCount(n)} ${n === 1 ? one : many}`

/** The dark bar while changes wait: how many, about how many people they touch, Discard and Review and save. */
export function PendingBar({ count, people, onDiscard, onReview }: { count: number; people: number; onDiscard: () => void; onReview: () => void }) {
  return (
    <div className="sticky bottom-3 mt-3 flex flex-wrap items-center gap-3 rounded-control bg-ink px-3 py-2 text-sm text-surface" role="status" data-testid="pending-bar">
      <span><b className="font-semibold">{plural(count, 'change', 'changes')} waiting</b> · affects about {plural(people, 'person', 'people')}</span>
      <span className="flex-1" />
      <Button variant="secondary" onClick={onDiscard}>Discard</Button>
      <Button variant="primary" onClick={onReview}>Review and save</Button>
    </div>
  )
}
