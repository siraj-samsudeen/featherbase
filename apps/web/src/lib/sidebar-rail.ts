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
      // A count, an icon, or anything hidden from screen readers (a rail's
      // initials tile) is not part of the row's name.
      else if (child instanceof Element && !child.hasAttribute('data-sidebar-count') && child.tagName.toLowerCase() !== 'svg' && child.getAttribute('aria-hidden') !== 'true') walk(child)
    }
  }
  walk(row)
  return text.replace(/\s+/g, ' ').trim()
}

/** The tooltip's words: the name, the count where there is one, and the key. */
export function railTip(row: Element): string {
  const count = rowCount(row)
  // The owner (18-Nov): a control's key shows on hover, not on the row itself.
  const key = row.getAttribute('data-shortcut-key')
  // #1251 (9e9da16a8): hover text is Title Case ("Collapse Sidebar · ⌘B"); a control whose
  // accessible name is in sentence case gives its hover words in data-tip.
  const name = row.getAttribute('data-tip') ?? rowLabel(row)
  const words = count ? `${name} · ${count}` : name
  return key ? `${words} · ${key}` : words
}

/** The controls named on hover in the open sidebar as well: Collapse, and the foot's icons. */
const OPEN_TIPS = '[data-testid=sidebar-collapse], [data-testid=help-button], [data-testid=theme-button]'

/** A floating layer beside a rail: one tooltip at a time, drawn fixed so no
 *  scrolling box clips it, to the right of the row, at once. */
export function attachRailTips({ root, layer, active, rowOf, drawer }: {
  /** Where pointer and focus events arrive from the rows. */
  root: HTMLElement
  /** Where the tooltip is drawn (a shadow root, or the document body). */
  layer: Node & ParentNode
  /** Whether the rail is showing (collapsed, not a drawer). */
  active: () => boolean
  /** The row an event's target belongs to, if any. */
  rowOf: (target: EventTarget | null) => HTMLElement | null
  /** Whether the sidebar is a drawer, where nothing is named on hover (a touch screen). */
  drawer?: () => boolean
}): () => void {
  let tip: HTMLElement | null = null
  let shownFor: HTMLElement | null = null
  const hide = () => { tip?.remove(); tip = null; shownFor = null }
  const show = (row: HTMLElement) => {
    // A row whose own menu is open (the avatar's Account menu) needs no tooltip over it.
    // The owner (18-Nov): the open sidebar's Collapse row and icon-only buttons (Help,
    // Theme) are named on hover too, with the key where they have one, as in the rail.
    const named = active() || (!drawer?.() && row.matches(OPEN_TIPS))
    if (!named || row.getAttribute('aria-expanded') === 'true') return hide()
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
  // The innermost target: inside an app's sidebar (a shadow root) the event's own target is the host.
  const over = (event: Event) => { const row = rowOf(event.composedPath()[0] ?? event.target); if (row) show(row) }
  const out = (event: Event) => {
    const to = (event as PointerEvent | FocusEvent).relatedTarget
    if (shownFor && to instanceof Node && shownFor.contains(to)) return
    hide()
  }
  root.addEventListener('pointerover', over)
  root.addEventListener('pointerout', out)
  root.addEventListener('focusin', over)
  root.addEventListener('focusout', out)
  // A click opens what the row opens (a menu): its tooltip goes with it.
  root.addEventListener('click', hide)
  window.addEventListener('scroll', hide, true)
  return () => {
    hide()
    root.removeEventListener('pointerover', over)
    root.removeEventListener('pointerout', out)
    root.removeEventListener('focusin', over)
    root.removeEventListener('focusout', out)
    root.removeEventListener('click', hide)
    window.removeEventListener('scroll', hide, true)
  }
}

/** Where a rail's menu opens: beside its button, kept inside the window. */
export function railMenuPlace(button: Element, menuHeight = 0): { left: number; top: number } {
  const box = button.getBoundingClientRect()
  const top = Math.max(8, Math.min(box.top - 6, window.innerHeight - menuHeight - 8))
  return { left: box.right + 8, top }
}

/** The owner's rule for the sidebar (17-Nov-2026): every heading and item reads
 *  in Title Case, each word capitalised, "and" as "&" ("People & Access",
 *  "All Tables"). Words already capitalised inside (MotherDuck) are kept. */
export function sidebarWords(label: string): string {
  return label
    .split(' ')
    .map((word) => (word === 'and' ? '&' : word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ')
}

/** Names that are brands are spelled the brand's way, whatever their stored case. */
const BRANDS: Record<string, string> = { motherduck: 'MotherDuck', postgres: 'Postgres', postgresql: 'PostgreSQL', duckdb: 'DuckDB' }

/** A data source's or database's stored name, as the sidebar shows it:
 *  "motherduck" → "MotherDuck", "gold" → "Gold", "sales_daily" → "Sales Daily". */
export function sourceWords(name: string): string {
  const brand = BRANDS[name.toLowerCase()]
  if (brand) return brand
  return sidebarWords(name.replace(/[_-]+/g, ' ').trim())
}
