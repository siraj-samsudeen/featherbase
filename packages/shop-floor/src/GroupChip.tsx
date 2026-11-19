import { fmtCount } from './format'

/** One group of related rows with its count ("Shelf 3"); pressed while chosen. A group with no rows stays listed, quieter. */
// #1348 board 3: a count chip is a blue tint, never a box; an empty group is a quiet grey one.
export function GroupChip({ label, count, selected = false, onSelect }: {
  label: string
  count?: number
  selected?: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} data-empty={count === 0 || undefined}
      className="[&[data-empty]:not([aria-pressed=true])]:bg-fill [&[data-empty]:not([aria-pressed=true])]:text-ink-subtle inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-action-tint px-3.5 text-control font-medium text-action transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus aria-pressed:bg-action aria-pressed:text-action-ink pointer-coarse:min-h-control motion-reduce:transition-none"
    >
      {label}
      {count != null && <>{' '}<span className="font-normal">{fmtCount(count)}</span></>}
    </button>
  )
}
