import type { ReactNode } from 'react'
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
  empty?: { title: ReactNode; body?: ReactNode; action?: ReactNode }
  className?: string
}) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const cards = layout === 'cards' || (layout === 'auto' && narrow)

  if (state === 'loading') return <Skeleton label={`Loading ${caption.toLowerCase()}`} lines={4} className={className} />
  if (state === 'error') return <Notice tone="negative" className={className}>{error ?? `Cannot load ${caption.toLowerCase()}`}</Notice>
  if (!rows.length)
    return (
      <EmptyState title={empty?.title ?? 'No rows yet'} action={empty?.action} className={className}>
        {empty?.body}
      </EmptyState>
    )

  if (cards) {
    const role = (r: PhoneRole) => columns.filter((c) => (c.phone ?? 'value') === r)
    const [titles, statuses, metas, values] = [role('title'), role('status'), role('meta'), role('value')]
    return (
      <ul aria-label={caption} className={cx('flex flex-col gap-2', className)}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-card border border-border bg-surface p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 font-semibold text-ink">
                {titles.map((c) => (
                  <div key={c.key}>{c.cell(row)}</div>
                ))}
              </div>
              {statuses.map((c) => (
                <div key={c.key} className="shrink-0">
                  {c.cell(row)}
                </div>
              ))}
            </div>
            {metas.length > 0 && (
              <p className="mt-1 text-sm text-ink-muted">
                {metas.map((c, i) => (
                  <span key={c.key}>
                    {i > 0 && ' · '}
                    {c.cell(row)}
                  </span>
                ))}
              </p>
            )}
            {values.length > 0 && (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {values.map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-ink-muted">{c.header}</dt>
                    <dd className={cx('text-ink', c.align === 'end' && 'text-right tabular-nums')}>{c.cell(row)}</dd>
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
    <div className={cx('overflow-x-auto rounded-card border border-border bg-surface', className)}>
      <table className="w-full border-collapse text-sm">
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
              {columns.map((c) => (
                <td key={c.key} className={cx('px-3 py-2.5 text-ink', c.align === 'end' && 'text-right tabular-nums')}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
