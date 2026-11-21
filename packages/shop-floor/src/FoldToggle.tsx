import type { ReactNode } from 'react'
import { cx } from './cx'
import { ChevronRight } from './icons'

/**
 * The control that opens and closes the rows under a row: a chevron that turns, with the
 * row's words. Use it for any row that folds others under it (a line and its working lines,
 * a reason and its adjustments), so every folding table reads the same.
 *
 * - With `children`, the words are part of the button.
 * - With `label` and no children, it is the chevron alone, named by `label`: for a row whose
 *   heading is a link, which sits beside the button, never inside it.
 * - `count` says how many rows are under it, in quiet type after the words.
 */
export function FoldToggle({ open, onToggle, label, count, children, className }: {
  open: boolean
  onToggle: () => void
  label?: string
  count?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return <>
    <button type="button" aria-expanded={open} aria-label={children ? undefined : label} onClick={onToggle}
      className={cx('inline-flex items-center gap-1 rounded-control text-left hover:text-action focus-visible:outline-2 focus-visible:outline-focus', className)}>
      <ChevronRight aria-hidden size={14} className={cx('shrink-0 text-ink-subtle transition-transform', open && 'rotate-90')} />{children}
    </button>
    {count != null && <span className="font-normal whitespace-nowrap text-ink-subtle">{count}</span>}
  </>
}
