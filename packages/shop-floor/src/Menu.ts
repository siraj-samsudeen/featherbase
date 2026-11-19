import { cx } from './cx'
import { raisedClasses } from './Card'

// #1348 fix-forward (UI owner): a menu item is a row, not a button. A filled button inside a raised surface is a
// fill on a fill (item 17), and a menu as narrow as a button wraps its longer items onto two lines.

/** A menu: a raised surface as wide as its longest item, never under 200px; groups inside are set apart by space. */
export function menuClasses(className?: string): string {
  return raisedClasses(cx('flex w-max min-w-[200px] max-w-[calc(100vw-1rem)] flex-col items-stretch p-1.5', className))
}

/** One item of a menu (a link or a button): left-aligned words on no fill, the hover tint under the pointer or
 *  keyboard focus, one line. `negative` is a destructive item: the same row in red words. */
export function menuItemClasses({ tone, className }: { tone?: 'negative'; className?: string } = {}): string {
  return cx(
    'flex min-h-[34px] w-full shrink-0 items-center justify-start gap-2 rounded-lg px-3 text-left text-sm whitespace-nowrap',
    tone === 'negative' ? 'text-negative' : 'text-ink',
    'hover:bg-hover focus-visible:bg-hover focus-visible:outline-[1.5px] focus-visible:outline-solid focus-visible:outline-offset-0 focus-visible:outline-focus',
    'aria-expanded:bg-action-tint aria-expanded:text-action disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )
}

/** A group of items within a menu: 8px of space above it when it follows another, never a line. */
export const MENU_GROUP_CLASSES = 'mt-2 flex flex-col items-stretch first:mt-0'

/** A group's small heading. */
export const MENU_HEADING_CLASSES = 'px-3 pt-1 pb-0.5 text-xs font-medium text-ink-muted'
