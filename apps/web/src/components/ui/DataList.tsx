import { useState, type ReactNode } from 'react'
import { ChevronDown } from './icons'
import { Button } from './Button'
import { cx } from './cx'
import { EmptyState, type EmptyDescriptor } from './EmptyState'
import { Notice } from './Notice'
import { Skeleton } from './Skeleton'
import { useMediaQuery } from './useMediaQuery'

/**
 * Where a column goes on a phone card: the `title` and `status` lead the card,
 * `meta` follows in one quiet line, `value` columns become labelled figures,
 * and `hidden` ones are left off the card (they stay in the wide table).
 */
export type PhoneRole = 'title' | 'status' | 'meta' | 'value' | 'hidden'

export interface DataColumn<Row> {
  key: string
  header: ReactNode
  cell: (row: Row) => ReactNode
  /** `end` for numbers: right-aligned, tabular figures. */
  align?: 'start' | 'end'
  phone?: PhoneRole
}

/** Below this width a list reads as cards (the usable-on-any-device promise). */
export const NARROW_QUERY = '(width < 40rem)'

/**
 * One list, two shapes: a table on a wide screen and a card per row on a
 * phone, so a phone never scrolls sideways to read a row. Loading, empty and
 * failed are states of the list, never an empty table.
 */
export function DataList<Row>({
  caption,
  rows,
  columns,
  rowKey,
  rowTestId,
  layout = 'auto',
  state = 'ready',
  error,
  empty,
  onRetry,
  className,
}: {
  /** Names the table or list for assistive tech; also the loading message. */
  caption: string
  rows: Row[]
  columns: DataColumn<Row>[]
  rowKey: (row: Row) => string
  /** A test id for each row's card or table row. */
  rowTestId?: (row: Row) => string
  layout?: 'auto' | 'table' | 'cards'
  state?: 'loading' | 'error' | 'ready'
  error?: ReactNode
  empty: EmptyDescriptor
  /** Offered as "Try again" when the load failed. */
  onRetry?: () => void
  className?: string
}) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const cards = layout === 'cards' || (layout === 'auto' && narrow)

  if (state === 'loading') return <Skeleton label={`Loading ${caption.toLowerCase()}`} lines={4} className={className} />
  if (state === 'error')
    return (
      <Notice tone="negative" className={className}>
        <p>{error ?? `Cannot load ${caption.toLowerCase()}`}</p>
        {onRetry && (
          <Button className="mt-2" onClick={onRetry}>
            Try again
          </Button>
        )}
      </Notice>
    )
  if (!rows.length)
    return (
      <EmptyState {...empty} className={className} />
    )

  if (cards) return <DataCards caption={caption} rows={rows} columns={columns} rowKey={rowKey} rowTestId={rowTestId} className={className} />

  return (
    // Focusable and named, so a keyboard can scroll a table wider than the screen.
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cx(
        'overflow-x-auto rounded-card border border-border bg-surface focus-visible:outline-2 focus-visible:outline-focus',
        className,
      )}
    >
      <table className="w-full border-collapse text-control">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-subtle">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx(
                  'border-b border-border px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted',
                  c.align === 'end' ? 'text-right' : 'text-left',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} data-testid={rowTestId?.(row)} className="border-b border-border last:border-b-0">
              {columns.map((c, i) => {
                const cls = cx('px-3 py-2.5 text-ink', c.align === 'end' && 'text-right tabular-nums', i === 0 && 'text-left font-semibold')
                // The first cell names its row for screen readers.
                return i === 0 ? (
                  <th key={c.key} scope="row" className={cls}>
                    {c.cell(row)}
                  </th>
                ) : (
                  <td key={c.key} className={cls}>
                    {c.cell(row)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A phone card shows at most this many `value` columns; the rest wait behind "N more". */
export const CARD_FIGURES = 3

/**
 * The phone shape of a list on its own: one card per row. A list that can
 * select or expand its rows passes `select` and `expand`, and each card then
 * carries a checkbox before its title and a show/hide toggle under its
 * figures, both thumb-sized. A card shows at most three `value` columns; one
 * with more says "N more", which opens the rest on that card in place.
 */
export function DataCards<Row>({
  caption,
  rows,
  columns,
  rowKey,
  rowTestId,
  select,
  expand,
  className,
  testId,
}: {
  caption: string
  rows: Row[]
  columns: DataColumn<Row>[]
  rowKey: (row: Row) => string
  rowTestId?: (row: Row) => string | undefined
  select?: { isSelected: (row: Row) => boolean; onToggle: (row: Row) => void; label: (row: Row) => string }
  expand?: { isExpanded: (row: Row) => boolean; onToggle: (row: Row) => void; render: (row: Row) => ReactNode }
  className?: string
  testId?: string
}) {
  const role = (r: PhoneRole) => columns.filter((c) => (c.phone ?? 'value') === r)
  const [titles, statuses, metas, values] = [role('title'), role('status'), role('meta'), role('value')]
  // The cards whose other columns the user opened with "N more".
  const [showingAll, setShowingAll] = useState<ReadonlySet<string>>(() => new Set())
  const toggleAll = (key: string) =>
    setShowingAll((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const more = Math.max(0, values.length - CARD_FIGURES)
  return (
    <ul aria-label={caption} data-testid={testId} className={cx('flex flex-col gap-2 text-control', className)}>
      {rows.map((row) => {
        const open = expand?.isExpanded(row) ?? false
        const key = rowKey(row)
        const all = showingAll.has(key)
        const shown = all ? values : values.slice(0, CARD_FIGURES)
        return (
          // Everything inside a card wraps rather than widening it: overflow-wrap is
          // inherited, and the descendant rule beats any nowrap a cell brings.
          <li
            key={key}
            data-testid={rowTestId?.(row)}
            className="min-w-0 wrap-anywhere rounded-card border border-border bg-surface p-3.5 [&_*]:whitespace-normal"
          >
            <div className="flex items-start gap-2">
              {select && (
                // The box is small; the label around it is the thumb-sized target.
                <label className="-my-2 -ml-2 inline-flex size-control shrink-0 cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    data-testid="row-check"
                    aria-label={select.label(row)}
                    checked={select.isSelected(row)}
                    onChange={() => select.onToggle(row)}
                    className="size-5 accent-action"
                  />
                </label>
              )}
              <div className="min-w-0 flex-1">
                {/* Wraps, so a status too wide to sit beside the title moves under it. */}
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  {/* The title takes the room the status leaves, down to 8rem; only
                      then does the status move under it. */}
                  <div className="min-w-0 flex-[1_1_8rem] font-semibold text-ink">
                    {titles.map((c) => (
                      <div key={c.key} className="wrap-anywhere">
                        {c.cell(row)}
                      </div>
                    ))}
                  </div>
                  {statuses.map((c) => (
                    <div key={c.key} className="min-w-0 max-w-full wrap-anywhere [&_*]:whitespace-normal">
                      {c.cell(row)}
                    </div>
                  ))}
                </div>
                {metas.length > 0 && (
                  <p className="mt-1 min-w-0 text-sm text-ink-muted">
                    {metas.map((c, i) => (
                      <span key={c.key}>
                        {i > 0 && ' · '}
                        {c.cell(row)}
                      </span>
                    ))}
                  </p>
                )}
                {values.length > 0 && (
                  // A label takes at most half the card and a value the rest, both able to wrap, so neither widens the card.
                  <dl className="mt-2 grid grid-cols-[fit-content(50%)_minmax(0,1fr)] gap-x-4 gap-y-1">
                    {shown.map((c) => (
                      <div key={c.key} className="contents">
                        <dt className="min-w-0 text-ink-muted">{c.header}</dt>
                        <dd className={cx('min-w-0 wrap-anywhere text-right text-ink', c.align === 'end' && 'tabular-nums')}>{c.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {more > 0 && (
                  <Button
                    variant="quiet"
                    className="-mb-1 mt-1 -ml-2"
                    aria-expanded={all}
                    data-testid="card-more"
                    onClick={() => toggleAll(key)}
                    icon={<ChevronDown aria-hidden size={18} />}
                  >
                    {all ? (
                      'Show fewer'
                    ) : (
                      <>
                        {more} more<span className="sr-only"> columns</span>
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
            {expand && (
              <>
                <Button
                  variant="quiet"
                  className="-mb-1 mt-2 -ml-2"
                  aria-expanded={open}
                  data-testid="row-expand"
                  onClick={() => expand.onToggle(row)}
                  icon={<ChevronDown aria-hidden size={18} className={cx('transition-transform motion-reduce:transition-none', open && 'rotate-180')} />}
                >
                  {open ? 'Hide nested rows' : 'Show nested rows'}
                </Button>
                {open && (
                  <div className="mt-2 border-t border-border pt-3" data-testid="expanded-row">
                    {expand.render(row)}
                  </div>
                )}
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}
