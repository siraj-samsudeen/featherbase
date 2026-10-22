import type { ReactNode } from 'react'
import { Button } from './Button'
import { cx } from './cx'
import { EmptyState } from './EmptyState'
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

/**
 * What an empty list says: a title plus an explanation, a way forward, or
 * both — never a bare "no rows" (usable-on-any-device: screens say when they
 * are empty, with the way forward).
 */
export type EmptyDescriptor = { title: ReactNode } & (
  | { body: ReactNode; action?: ReactNode }
  | { action: ReactNode; body?: ReactNode }
)

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
      <EmptyState title={empty.title} action={empty.action} className={className}>
        {empty.body}
      </EmptyState>
    )

  if (cards) {
    const role = (r: PhoneRole) => columns.filter((c) => (c.phone ?? 'value') === r)
    const [titles, statuses, metas, values] = [role('title'), role('status'), role('meta'), role('value')]
    return (
      <ul aria-label={caption} className={cx('flex flex-col gap-2 text-control', className)}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-card border border-border bg-surface p-3.5">
            {/* Wraps, so a status too wide to sit beside the title moves under it. */}
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <div className="min-w-0 font-semibold text-ink">
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
              <p className="mt-1 text-ink-muted">
                {metas.map((c, i) => (
                  <span key={c.key}>
                    {i > 0 && ' · '}
                    {c.cell(row)}
                  </span>
                ))}
              </p>
            )}
            {values.length > 0 && (
              // A zero-minimum value track, so a long unbroken value wraps instead of widening the card.
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                {values.map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-ink-muted">{c.header}</dt>
                    <dd className={cx('min-w-0 wrap-anywhere text-ink', c.align === 'end' && 'text-right tabular-nums')}>{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    )
  }

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
            <tr key={rowKey(row)} className="border-b border-border last:border-b-0">
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
