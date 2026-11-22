import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * One active filter on a list (#1289): a big chip that reads as a sentence ("Site: Kerala HO"), with a round ✕
 * that is easy to see and hit. `name` says which filter the ✕ removes, for a screen reader.
 */
export function FilterChip({ children, name, onRemove, className, tone }: {
  children: ReactNode
  name: string
  onRemove: () => void
  className?: string
  /** #1289 option C: a value picked in Click To Narrow reads green, as it is in the panel (board A). */
  tone?: 'picked'
}) {
  const picked = tone === 'picked'
  return (
    <span
      className={cx('inline-flex max-w-full items-center rounded-full pl-3 pr-1',
        picked ? 'min-h-[30px] gap-1.5 bg-chip-green text-[13px] text-chip-green-ink' : 'min-h-control gap-1.5 bg-action-tint py-1 text-sm text-ink', className)}
      data-testid="filter-chip"
      data-tone={tone}
    >
      <span className="min-w-0 truncate">{children}</span>
      <button
        type="button"
        aria-label={`Remove ${name} filter`}
        onClick={onRemove}
        className={cx('grid size-6 flex-none place-items-center rounded-full text-xs focus-visible:outline-2 focus-visible:outline-focus',
          picked ? 'text-chip-green-ink hover:bg-chip-green-ink/15' : 'text-action hover:bg-action/15')}
      >
        ✕
      </button>
    </span>
  )
}
