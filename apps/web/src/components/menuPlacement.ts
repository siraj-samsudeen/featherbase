/** Which edge of its button a menu lines up with: `end` = the right edge, `start` = the left. */
export type MenuAlign = 'start' | 'end'

type Span = { left: number; right: number }

/**
 * The horizontal span of `element` a person can actually see: the window,
 * narrowed by every ancestor that clips or scrolls its overflow (#1185 — the
 * Admin's content column does, so the window alone over-reports the room).
 */
export function visibleSpan(element: Element): Span {
  let left = 0
  let right = window.innerWidth
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).overflowX === 'visible') continue
    const box = ancestor.getBoundingClientRect()
    left = Math.max(left, box.left)
    right = Math.min(right, box.right)
  }
  return { left, right }
}

/** Keep the right edge where the menu fits there; otherwise the left; with room on neither, the roomier side. */
export function menuAlign(button: Span, menuWidth: number, visible: Span): MenuAlign {
  if (button.right - menuWidth >= visible.left) return 'end'
  if (button.left + menuWidth <= visible.right) return 'start'
  return visible.right - button.left > button.right - visible.left ? 'start' : 'end'
}
