import { fmtCount } from './format'

/** One group of related rows with its count ("Shelf 3"); pressed while chosen. A group with no rows stays listed, quieter. */
export function GroupChip({ label, count, selected = false, onSelect }: {
  label: string
  count?: number
  selected?: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} data-empty={count === 0 || undefined}
      className="data-empty:border-border data-empty:text-ink-muted inline-flex min-h-control items-center gap-1.5 rounded-full border border-border-control bg-surface px-3 text-control font-medium text-ink transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus aria-pressed:border-action aria-pressed:bg-action aria-pressed:text-action-ink motion-reduce:transition-none"
    >
      {label}
      {count != null && <>{' '}<span className="font-normal">{fmtCount(count)}</span></>}
    </button>
  )
}
