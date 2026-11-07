import { useId } from 'react'
import { cx } from './cx'

/** A row's name, then its code when people use one: "North bay (B-104)". */
export function nameAndCode(label: string, code?: string): string {
  return code ? `${label} (${code})` : label
}

/** A small, quiet action beside a value (Go there, Filter, Focus here). */
export const smallActionClasses = cx(
  'inline-flex min-h-8 shrink-0 items-center rounded-control border border-border px-2 text-xs font-medium text-ink-muted transition-colors',
  'hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent motion-reduce:transition-none',
  'pointer-coarse:min-h-control',
)

/** A small caption naming a row's table, e.g. "Shelf". */
export function KindTag({ children }: { children: string }) {
  return <span className="shrink-0 rounded-control border border-border px-1.5 text-xs text-ink-muted">{children}</span>
}

/**
 * A linked row: its name (and code) as a button that opens it, with optional
 * Go there and Filter actions. A row the viewer cannot read shows only
 * "Not visible to you": no name, no code, no action.
 */
export function LinkChip({ label, code, kind, onOpen, onGoThere, onFilter, filterDisabledReason, unreadable = false }: {
  label: string
  code?: string
  kind?: string
  onOpen?: () => void
  onGoThere?: () => void
  onFilter?: () => void
  filterDisabledReason?: string
  unreadable?: boolean
}) {
  const reasonId = useId()
  if (unreadable) return <span className="text-sm italic text-ink-muted">Not visible to you</span>
  const text = nameAndCode(label, code)
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      {onOpen
        ? <button type="button" onClick={onOpen} className="min-w-0 text-left text-sm font-medium text-action wrap-anywhere hover:underline focus-visible:outline-2 focus-visible:outline-focus">{text}</button>
        : <span className="min-w-0 text-sm font-medium text-ink wrap-anywhere">{text}</span>}
      {kind && <KindTag>{kind}</KindTag>}
      {onGoThere && <button type="button" onClick={onGoThere} className={smallActionClasses}>Go there</button>}
      {(onFilter || filterDisabledReason) && <>
        <button type="button" onClick={onFilter} disabled={!!filterDisabledReason}
          title={filterDisabledReason} aria-describedby={filterDisabledReason ? reasonId : undefined}
          className={smallActionClasses}>Filter</button>
        {filterDisabledReason && <span id={reasonId} hidden>{filterDisabledReason}</span>}
      </>}
    </span>
  )
}
