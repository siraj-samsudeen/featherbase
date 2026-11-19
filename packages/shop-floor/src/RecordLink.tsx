import { createContext, useContext, type MouseEvent, type ReactNode } from 'react'
import { rowHref } from 'shared'
import { cx } from './cx'

// The navigation rule (owner, 16-Nov-2026, #1227): "everything that is a record
// in FB has to be presented as a link". Every Featherbase record shown on any
// screen is a RecordLink; a plain-text record name is a bug. It is presentational
// on purpose, so the Admin, the account pages and every app bundle use the same
// one: the caller knows the record's name, who it is (#1216's identity line)
// and whether the viewer may open it.

/** Where a record opens when an app has a page of its own for its Table (a
 *  Dash section, a Tasker task); `undefined` falls back to the Featherbase record. */
export type RecordPageFor = (table: string, rowId: string) => string | undefined

const RecordPages = createContext<RecordPageFor>(() => undefined)

/** An app maps its own Tables to its own pages, once, around its screens. */
export function RecordPagesProvider({ pageFor, children }: { pageFor: RecordPageFor; children: ReactNode }) {
  const outer = useContext(RecordPages)
  return <RecordPages.Provider value={(table, rowId) => pageFor(table, rowId) ?? outer(table, rowId)}>{children}</RecordPages.Provider>
}

/** Where a record opens: an app's own page for it, else its Featherbase record. */
export function useRecordHref(table: string, rowId: string): string {
  return useContext(RecordPages)(table, rowId) ?? rowHref(table, rowId)
}

/**
 * One Featherbase record, as a link to it.
 *
 * - `name` is the record's readable name; never pass an opaque id as it (a
 *   person's `psn_…`): without a name the link says "Unnamed record".
 * - `detail` is who or what it is, beside the name (#1216: "E1001 · Team
 *   Leader · Lakeside"). `layout="two-lines"` puts it under the name where
 *   there is room; `inline` (the default) after a middle dot.
 * - `canOpen={false}` (the viewer may not open it) is the one case drawn as
 *   plain text, the same words, with no link.
 * - `inLink` draws the same words inside a row that is itself the link to
 *   this record (a search result): a link may not hold another.
 * - `href` names the destination outright; otherwise an app's page for the
 *   Table (RecordPagesProvider), else the Featherbase record.
 * - `onNavigate` lets a single-page screen open it in place; modified clicks
 *   (new tab, new window) stay the browser's.
 */
export function RecordLink({
  table, rowId, name, detail, canOpen = true, inLink = false, href, layout = 'inline', onNavigate, className,
}: {
  table: string
  rowId: string
  name?: string | null
  /** Words, or a node of them (PersonLabel marks each part so a narrow space can drop one). */
  detail?: ReactNode
  canOpen?: boolean
  inLink?: boolean
  href?: string
  layout?: 'inline' | 'two-lines'
  onNavigate?: (href: string) => void
  className?: string
}) {
  const fallback = useRecordHref(table, rowId)
  const to = href ?? fallback
  const label = name?.trim() || 'Unnamed record'
  const words = (
    <>
      <span className={cx('min-w-0 wrap-anywhere', canOpen && 'font-medium')}>{label}</span>
      {detail && (layout === 'two-lines'
        ? <span className="block text-xs text-ink-muted" data-testid="record-detail">{detail}</span>
        : <>{' '}<span className="text-ink-muted" data-testid="record-detail">· {detail}</span></>)}
    </>
  )
  const shape = layout === 'two-lines' ? 'inline-flex min-w-0 flex-col' : 'min-w-0'
  if (inLink && canOpen)
    return <span className={cx(shape, 'text-ink', className)} data-record-link="in-link" data-table={table} data-row={rowId}>{words}</span>
  if (!canOpen)
    return <span className={cx(shape, 'text-ink', className)} data-record-link="text" data-table={table} data-row={rowId}>{words}</span>
  return (
    <a
      href={to}
      data-record-link="link"
      data-table={table}
      data-row={rowId}
      onClick={onNavigate ? (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
        event.preventDefault()
        onNavigate(to)
      } : undefined}
      className={cx(shape, 'rounded-control text-action underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus', className)}
    >
      {words}
    </a>
  )
}
