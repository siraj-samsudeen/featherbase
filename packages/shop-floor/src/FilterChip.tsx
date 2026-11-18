import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * One active filter on a list (#1289): a big chip that reads as a sentence ("Site: Kerala HO"), with a round ✕
 * that is easy to see and hit. `name` says which filter the ✕ removes, for a screen reader.
 */
export function FilterChip({ children, name, onRemove, className }: {
  children: ReactNode
  name: string
  onRemove: () => void
  className?: string
}) {
  return (
    <span
      className={cx('inline-flex min-h-control max-w-full items-center gap-1.5 rounded-full bg-action-tint py-1 pl-3 pr-1 text-sm text-ink', className)}
      data-testid="filter-chip"
    >
      <span className="min-w-0 truncate">{children}</span>
      <button
        type="button"
        aria-label={`Remove ${name} filter`}
        onClick={onRemove}
        className="grid size-6 flex-none place-items-center rounded-full text-xs text-action hover:bg-action/15 focus-visible:outline-2 focus-visible:outline-focus"
      >
        ✕
      </button>
    </span>
  )
}
