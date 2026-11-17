import { useEffect } from 'react'

/**
 * #1249: a list's table scrolls inside its own box, and the box is never taller
 * than the room left on screen below it, so its bottom edge, with the
 * horizontal scroll bar, and the pager after it are always in view. Without
 * this a wide table's scroll bar sat under its last row, below the window.
 *
 * The room is measured from where the box sits when the page is scrolled to
 * the top, inside the page's scrolling area (Admin's <main>); the element right
 * after the box's wrapper (the pager) keeps its own height below it. A short
 * table is untouched: this only caps the height, never sets it.
 */
export function useFitToWindow(box: HTMLElement | null, least = 240): void {
  useEffect(() => {
    if (!box) return
    // The page's scrolling area: Admin's <main>, else the document itself.
    const root = (document.scrollingElement ?? document.documentElement) as HTMLElement
    const page = (box.closest('main') as HTMLElement | null) ?? root
    const fit = () => {
      const pageTop = page === root ? 0 : page.getBoundingClientRect().top
      const restTop = box.getBoundingClientRect().top - pageTop + page.scrollTop
      const padBottom = parseFloat(getComputedStyle(page).paddingBottom) || 0
      const tail = box.parentElement?.nextElementSibling as HTMLElement | null | undefined
      const tailHeight = tail ? tail.getBoundingClientRect().height + (parseFloat(getComputedStyle(tail).marginTop) || 0) : 0
      const room = Math.floor(page.clientHeight - restTop - tailHeight - padBottom)
      box.style.maxHeight = `${Math.max(least, room)}px`
    }
    fit()
    // What sits above the box can change height (filters wrapping, a banner):
    // watching the page's content keeps the fit current. The box's own cap
    // does not move its top, so this settles at once.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : undefined
    observer?.observe(page)
    if (page.firstElementChild) observer?.observe(page.firstElementChild)
    window.addEventListener('resize', fit)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', fit)
      box.style.maxHeight = ''
    }
  }, [box, least])
}
