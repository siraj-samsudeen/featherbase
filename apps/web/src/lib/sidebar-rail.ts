// #1248: collapsed, a sidebar is an icon rail (the Admin's and every app's
// <featherbase-sidebar>). What both rails share lives here: a row's initials
// when it has no icon of its own, its name and count for the tooltip, the
// tooltip itself, and the menu a folded group opens. Each sidebar draws its own
// frame; these work on whatever rows it holds.

/** "Repair jobs" → "RJ", "System" → "Sy": the rail's mark for a row without an icon. */
export function railMark(label: string): string {
  const words = label.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word))
  if (words.length === 0) return ''
  if (words.length === 1) {
    const [first, second = ''] = [...words[0].replace(/[^\p{L}\p{N}]/gu, '')]
    return `${first.toUpperCase()}${second.toLowerCase()}`
  }
  return words.slice(0, 2).map((word) => [...word.replace(/[^\p{L}\p{N}]/gu, '')][0]?.toUpperCase() ?? '').join('')
}

/** A row's count, where it marks one (`data-sidebar-count`). */
export function rowCount(row: Element): string | undefined {
  const text = row.querySelector('[data-sidebar-count]')?.textContent?.trim()
  return text ? text : undefined
}

/** A row's name as a person reads it: its own label, without its count. */
export function rowLabel(row: Element): string {
  const named = row.getAttribute('aria-label')
  if (named) return named.trim()
  let text = ''
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent
      else if (child instanceof Element && !child.hasAttribute('data-sidebar-count') && child.tagName.toLowerCase() !== 'svg') walk(child)
    }
  }
  walk(row)
  return text.replace(/\s+/g, ' ').trim()
}

/** The tooltip's words: the name, and the count where there is one. */
export function railTip(row: Element): string {
  const count = rowCount(row)
  return count ? `${rowLabel(row)} · ${count}` : rowLabel(row)
}

/** A floating layer beside a rail: one tooltip at a time, drawn fixed so no
 *  scrolling box clips it, to the right of the row, at once. */
export function attachRailTips({ root, layer, active, rowOf }: {
  /** Where pointer and focus events arrive from the rows. */
  root: HTMLElement
  /** Where the tooltip is drawn (a shadow root, or the document body). */
  layer: Node & ParentNode
  /** Whether the rail is showing (collapsed, not a drawer). */
  active: () => boolean
  /** The row an event's target belongs to, if any. */
  rowOf: (target: EventTarget | null) => HTMLElement | null
}): () => void {
  let tip: HTMLElement | null = null
  let shownFor: HTMLElement | null = null
  const hide = () => { tip?.remove(); tip = null; shownFor = null }
  const show = (row: HTMLElement) => {
    if (!active()) return hide()
    const words = railTip(row)
    if (!words) return hide()
    tip ??= Object.assign(document.createElement('div'), { role: 'tooltip' })
    tip.setAttribute('role', 'tooltip')
    tip.dataset.testid = 'sidebar-tooltip'
    tip.className = 'featherbase-rail-tip'
    tip.textContent = words
    const box = row.getBoundingClientRect()
    tip.style.cssText = `position:fixed;left:${box.right + 10}px;top:${box.top + box.height / 2}px;transform:translateY(-50%);z-index:60;pointer-events:none`
    if (!tip.isConnected) layer.append(tip)
    shownFor = row
  }
  const over = (event: Event) => { const row = rowOf(event.target); if (row) show(row) }
  const out = (event: Event) => {
    const to = (event as PointerEvent | FocusEvent).relatedTarget
    if (shownFor && to instanceof Node && shownFor.contains(to)) return
    hide()
  }
  root.addEventListener('pointerover', over)
  root.addEventListener('pointerout', out)
  root.addEventListener('focusin', over)
  root.addEventListener('focusout', out)
  window.addEventListener('scroll', hide, true)
  return () => {
    hide()
    root.removeEventListener('pointerover', over)
    root.removeEventListener('pointerout', out)
    root.removeEventListener('focusin', over)
    root.removeEventListener('focusout', out)
    window.removeEventListener('scroll', hide, true)
  }
}

/** Where a rail's menu opens: beside its button, kept inside the window. */
export function railMenuPlace(button: Element, menuHeight = 0): { left: number; top: number } {
  const box = button.getBoundingClientRect()
  const top = Math.max(8, Math.min(box.top - 6, window.innerHeight - menuHeight - 8))
  return { left: box.right + 8, top }
}
