import { fmtCount } from './format'

/** One group of related rows with its count ("Shelf 3"); pressed while chosen. */
export function GroupChip({ label, count, selected = false, onSelect }: {
  label: string
  count?: number
  selected?: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect}
      className="inline-flex min-h-control items-center gap-1.5 rounded-full border border-border-control bg-surface px-3 text-control font-medium text-ink transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus aria-pressed:border-action aria-pressed:bg-action aria-pressed:text-action-ink motion-reduce:transition-none"
    >
      {label}
      {count != null && <>{' '}<span className="font-normal">{fmtCount(count)}</span></>}
    </button>
  )
}
