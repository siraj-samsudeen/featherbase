import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronRight } from '@featherbase/shop-floor'

// #1015: a list row is one line. A value's own width sets its column's, up to
// a maximum, and past that it is clipped; hovering it shows the rest.

/** A browser only says a box is clipped once it is laid out, so the full text
 *  is put on at hover: a value that fits gets no tooltip repeating it. */
function showFullTextIfClipped(event: MouseEvent<HTMLElement>) {
  const box = event.currentTarget
  // The clipped part's own words: the name's, not the Retired badge beside it.
  const clipped = [box, ...box.children].find((el) => el.scrollWidth > el.clientWidth && el.clientWidth > 0)
  if (clipped) box.title = clipped.textContent?.trim() ?? ''
  else box.removeAttribute('title')
}

/** One clipped value, at most as wide as `className` allows. */
export function OneLine({ children, className = 'max-w-80' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`truncate ${className}`} onMouseEnter={showFullTextIfClipped}>
      {children}
    </div>
  )
}

/** Whether a sideways-scrolling box has more to show at its right. */
export function useMoreToTheRight(box: HTMLElement | null): boolean {
  const [more, setMore] = useState(false)
  useEffect(() => {
    if (!box) {
      setMore(false)
      return
    }
    // A pixel of slack: scroll positions are fractional on a zoomed screen.
    const measure = () => setMore(box.scrollLeft + box.clientWidth < box.scrollWidth - 1)
    measure()
    box.addEventListener('scroll', measure, { passive: true })
    // The table inside grows as columns and link names arrive.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(box)
    if (box.firstElementChild) observer?.observe(box.firstElementChild)
    return () => {
      box.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [box])
  return more
}

/** The fade and arrow at the right edge. A horizontal scrollbar sits below the
 *  last row, off screen on a long list, and macOS hides it anyway. */
export function MoreColumnsHint({ box }: { box: HTMLElement | null }) {
  return (
    <div
      className="pointer-events-none absolute z-[2] inset-y-px right-px w-14 rounded-r-[inherit] bg-linear-to-l from-surface to-transparent"
      data-testid="list-more-columns"
    >
      <button
        type="button"
        aria-label="Show more columns"
        onClick={() => box?.scrollBy({ left: box.clientWidth * 0.6, behavior: 'smooth' })}
        // Halfway down, so it's in sight whether the list is scrolled to its top or its end.
        className="pointer-events-auto absolute right-1 top-1/2 flex -translate-y-1/2 size-7 items-center justify-center rounded-full border border-border bg-surface text-ink-muted shadow-sm hover:text-action"
      >
        <ChevronRight aria-hidden size={16} />
      </button>
    </div>
  )
}
