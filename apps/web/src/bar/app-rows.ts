import { railMark, railMenuPlace, rowCount, rowLabel } from '../lib/sidebar-rail'
import { setSidebarDrawerOpen } from '../lib/sidebar-collapsed'

// #1248: the app's own rows in <featherbase-sidebar>, the light-DOM children an
// app writes (Tasker, Tickets, Dash, Equipment). The frame around them is the
// platform's; this is what the rail does to the rows themselves: their marks
// and initials, a folding heading's menu, and the drawer closing on a choice.

/** The rail's rules for the app's own rows. They live in the app's document,
 *  scoped to this element's name, because a shadow's ::slotted() reaches a row
 *  but not the label or count inside it. Labels are hidden by clipping, never
 *  removed, so every row keeps its accessible name. */
const RAIL_ROWS_CSS = `
featherbase-sidebar[data-collapsed] > :is(button, a) > :not(svg):not([data-sidebar-count]),
featherbase-sidebar[data-collapsed] > [data-rail-fold] > :not(svg) {
  position:absolute !important; width:1px !important; height:1px !important; padding:0 !important; margin:-1px !important;
  overflow:hidden !important; clip-path:inset(50%) !important; white-space:nowrap !important; border:0 !important; }
featherbase-sidebar[data-collapsed] > :is(button, a)[data-rail-mark] > svg { display:none !important; }
featherbase-sidebar[data-collapsed] > :is(button, a)[data-rail-mark]::before {
  content:attr(data-rail-mark); display:grid; place-items:center; width:26px; height:26px; box-sizing:border-box;
  background:color-mix(in srgb, currentColor 15%, transparent); border-radius:7px; font-size:12px; font-weight:700; letter-spacing:.02em; line-height:1; }
featherbase-sidebar[data-collapsed] > :is(button, a) [data-sidebar-count] {
  position:absolute !important; top:-2px !important; right:-4px !important; min-width:18px; height:18px; padding:0 4px !important; box-sizing:border-box;
  border-radius:8px !important; background:var(--color-action) !important; color:var(--color-action-ink) !important;
  font-size:12px !important; font-weight:700 !important; line-height:18px !important; text-align:center; margin:0 !important; }
featherbase-sidebar[data-collapsed] > :is(button, a) [data-sidebar-count][data-rail-zero] { display:none !important; }
featherbase-sidebar[data-collapsed] > [data-depth="1"] { display:none !important; }
featherbase-sidebar[data-collapsed] > :not(button):not(a):not([data-rail-fold]) {
  font-size:0 !important; line-height:0 !important; height:1px !important; min-height:0 !important; padding:0 !important;
  margin:8px 12px !important; background:transparent !important; overflow:hidden !important; border:0 !important; }
featherbase-sidebar[data-collapsed] > [data-rail-fold] {
  display:flex !important; align-items:center; justify-content:center; width:40px; height:40px; margin:4px auto !important; padding:0 !important;
  border-radius:var(--radius-control, 10px); color:var(--color-ink-muted); cursor:pointer; position:relative; }
featherbase-sidebar[data-collapsed] > [data-rail-fold]:hover, featherbase-sidebar[data-collapsed] > [data-rail-fold][aria-expanded="true"] {
  background:color-mix(in srgb, var(--color-border) 50%, transparent); color:var(--color-ink); }
featherbase-sidebar[data-collapsed] > [data-rail-fold]:focus-visible { outline:2px solid var(--color-focus); outline-offset:1px; }
featherbase-sidebar:not([data-collapsed]) > [data-rail-fold] > svg { display:none; }
/* #1253 (Quiet Canvas): beside the sidebar, the app's page is one white panel on
   the grey canvas, set off by a soft shadow, 8px from the window's edges. The
   gap wins over an app's own margin on its page (Dash centres it with auto). */
@media (width >= 48rem) {
  featherbase-sidebar + * { background:var(--color-surface); border-radius:12px; margin:8px 8px 8px 0 !important; width:auto !important; min-width:0;
    box-shadow:0 1px 3px color-mix(in srgb, var(--color-scrim) 10%, transparent), 0 1px 2px -1px color-mix(in srgb, var(--color-scrim) 10%, transparent); }
}
`

export function ensureRailRowsCss() {
  if (document.getElementById('featherbase-sidebar-rail')) return
  const style = document.createElement('style')
  style.id = 'featherbase-sidebar-rail'
  style.textContent = RAIL_ROWS_CSS
  document.head.append(style)
}


/** The app's rows' behaviour, attached to the sidebar element: `setRail` as the
 *  rail opens and shuts; `rowOf` names the row a tooltip is for. */
export interface AppRows {
  setRail(rail: boolean): void
  rowOf(target: EventTarget | null): HTMLElement | null
  detach(): void
}

export function attachAppRows(host: HTMLElement, layer: HTMLElement): AppRows {
  let rail = false
  let menu: { el: HTMLElement; heading: HTMLElement; close: (focus: boolean) => void } | undefined

  /** The rail's marks on the app's rows: initials where a row has no icon of
   *  its own (or asks for them), a zero count without a badge, and a folding
   *  heading made a button. Taken off again when the sidebar opens. */
  const markRows = (on: boolean) => {
    rowsObserver.disconnect()
    for (const row of Array.from(host.children) as HTMLElement[]) {
      if (row.matches('button, a')) {
        const mark = on && (row.hasAttribute('data-rail-initials') || !row.querySelector('svg')) ? railMark(rowLabel(row)) : ''
        if (mark) row.setAttribute('data-rail-mark', mark)
        else row.removeAttribute('data-rail-mark')
        row.querySelectorAll('[data-sidebar-count]').forEach((count) => count.toggleAttribute('data-rail-zero', on && rowCount(row) === '0'))
      } else if (row.hasAttribute('data-rail-fold')) {
        if (on) {
          row.setAttribute('role', 'button')
          row.setAttribute('tabindex', '0')
          row.setAttribute('aria-haspopup', 'menu')
          row.setAttribute('aria-expanded', 'false')
          row.removeAttribute('aria-label')
          row.setAttribute('aria-label', rowLabel(row))
        } else for (const name of ['role', 'tabindex', 'aria-haspopup', 'aria-expanded', 'aria-label']) row.removeAttribute(name)
      }
    }
    rowsObserver.observe(host, { childList: true, subtree: true, characterData: true })
  }
  // The app redraws its rows (a new report, a changed count): the rail marks follow.
  const rowsObserver = new MutationObserver(() => { if (rail) markRows(true) })

  const foldOf = (target: EventTarget | null): HTMLElement | null => {
    if (!rail || !(target instanceof Element)) return null
    const heading = target.closest('[data-rail-fold]') as HTMLElement | null
    return heading && heading.parentElement === host ? heading : null
  }

  /** The nested rows a folded heading stands for: those after it, up to the next row that is not nested. */
  const foldedRows = (heading: HTMLElement): HTMLElement[] => {
    const rows: HTMLElement[] = []
    for (let next = heading.nextElementSibling; next; next = next.nextElementSibling) {
      if (!next.matches('[data-depth="1"]')) break
      rows.push(next as HTMLElement)
    }
    return rows
  }

  const toggleMenu = (heading: HTMLElement) => {
    if (menu?.heading === heading) menu.close(false)
    else openMenu(heading)
  }

  const openMenu = (heading: HTMLElement) => {
    menu?.close(false)
    // The menu takes the tooltip's place beside the heading.
    layer.querySelector('.featherbase-rail-tip')?.remove()
    const label = rowLabel(heading)
    const el = document.createElement('div')
    el.className = 'rail-menu'
    el.setAttribute('role', 'menu')
    el.setAttribute('aria-label', label)
    const title = document.createElement('div')
    title.className = 'heading'
    title.textContent = label
    title.setAttribute('aria-hidden', 'true')
    el.append(title)
    const items = foldedRows(heading).map((row) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'menuitem')
      item.tabIndex = -1
      if (row.getAttribute('aria-current')) item.setAttribute('aria-current', row.getAttribute('aria-current')!)
      const name = document.createElement('span')
      name.textContent = rowLabel(row)
      item.append(name)
      const count = rowCount(row)
      if (count !== undefined) {
        const n = document.createElement('span')
        n.className = 'count'
        n.textContent = count
        item.append(n)
      }
      item.addEventListener('click', () => { close(false); row.click() })
      return item
    })
    el.append(...items)
    const close = (focus: boolean) => {
      el.remove()
      heading.setAttribute('aria-expanded', 'false')
      document.removeEventListener('pointerdown', outside, true)
      if (menu?.el === el) menu = undefined
      if (focus) heading.focus()
    }
    const outside = (event: Event) => {
      if (!event.composedPath().includes(el) && !event.composedPath().includes(heading)) close(false)
    }
    el.addEventListener('keydown', (event) => {
      const at = items.indexOf((host.shadowRoot?.activeElement ?? null) as HTMLButtonElement)
      if (event.key === 'Escape' || event.key === 'ArrowLeft') { event.preventDefault(); close(true) }
      else if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus() }
      else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus() }
      else if (event.key === 'Tab') close(false)
    })
    layer.append(el)
    const place = railMenuPlace(heading, el.getBoundingClientRect().height)
    el.style.left = `${place.left}px`
    el.style.top = `${place.top}px`
    heading.setAttribute('aria-expanded', 'true')
    document.addEventListener('pointerdown', outside, true)
    menu = { el, heading, close }
    items[0]?.focus()
  }

  const onClick = (event: Event) => {
    // A folded heading in the rail opens its menu.
    const heading = foldOf(event.target)
    if (heading) { toggleMenu(heading); return }
    // Choosing a destination in the drawer closes it, as in the Admin.
    if (event.composedPath().some((node) => node instanceof HTMLElement && node !== host && (node.tagName === 'A' || node.tagName === 'BUTTON')))
      setSidebarDrawerOpen(false)
  }
  const onKey = (event: KeyboardEvent) => {
    const heading = foldOf(event.target)
    if (heading && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight')) {
      event.preventDefault()
      openMenu(heading)
    }
  }

  ensureRailRowsCss()
  host.addEventListener('click', onClick)
  host.addEventListener('keydown', onKey)
  rowsObserver.observe(host, { childList: true, subtree: true, characterData: true })

  return {
    setRail(next) {
      if (rail === next) return
      rail = next
      menu?.close(false)
      markRows(next)
    },
    rowOf(target) {
      const element = target instanceof Element ? target : null
      // #1385: a row of the platform's groups, below the app's own.
      const platform = element?.closest<HTMLElement>('.sidebar-defaults :is(a, button)')
      if (platform) return platform
      const row = (element?.closest('featherbase-sidebar > *') ?? null) as HTMLElement | null
      return row && row.parentElement === host && (row.matches('button, a') || row.hasAttribute('data-rail-fold')) && !menu ? row : null
    },
    detach() {
      menu?.close(false)
      rowsObserver.disconnect()
      host.removeEventListener('click', onClick)
      host.removeEventListener('keydown', onKey)
    },
  }
}
