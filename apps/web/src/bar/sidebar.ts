import { APP_ACCENT_ATTRIBUTE } from '@featherbase/shop-floor/theme'
import platformCss from '../index.css?inline'
import { shadowCss } from './style'
import { getSignedInUser } from '../lib/api'
import { SIDEBAR_DRAWER_QUERY, SIDEBAR_SHORTCUT, offerSidebarSlots, readSidebar, registerSidebar, setSidebarDrawerOpen, subscribeSidebar, toggleSidebarCollapsed } from '../lib/sidebar-collapsed'
import { attachRailTips, railMark, railMenuPlace, rowCount, rowLabel } from '../lib/sidebar-rail'

/** Admin's sidebar widths (AdminLayout: md:w-60, the rail md:w-14, a w-64 drawer), for every app (#1227, #1248). */
const WIDTH = 240
const RAIL = 56
const DRAWER_WIDTH = 256

const COLLAPSE_ICON = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/></svg>'
const EXPAND_ICON = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 17 5-5-5-5M6 17l5-5-5-5"/></svg>'

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
  margin:8px 12px !important; background:color-mix(in srgb, var(--color-border) 70%, transparent) !important; overflow:hidden !important; border:0 !important; }
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

function ensureRailRowsCss() {
  if (document.getElementById('featherbase-sidebar-rail')) return
  const style = document.createElement('style')
  style.id = 'featherbase-sidebar-rail'
  style.textContent = RAIL_ROWS_CSS
  document.head.append(style)
}

/** Apps supply direct buttons/links and keep their own handlers and state.
 *  The platform owns the navigation frame, row presentation and, since #1227,
 *  the frame's behaviour, the same as the Admin's sidebar: its width, the
 *  collapsed choice (its own footer and edge, and Ctrl/Cmd+B), and the drawer
 *  over the page at phone width. The app gives it an `auto` column.
 *
 *  #1248: collapsed, it is an icon rail, never hidden. For the rail an app may
 *  mark a row `data-rail-initials` (show its initials, not a shared icon), a
 *  count `data-sidebar-count` (a badge, and the tooltip's number), and a
 *  heading `data-rail-fold` with an icon of its own: in the rail it is one
 *  button whose menu lists the `data-depth="1"` rows after it. */
export class FeatherbaseSidebar extends HTMLElement {
  private themeObserver?: MutationObserver
  private rowsObserver?: MutationObserver
  private leave?: () => void
  private unsubscribe?: () => void
  private untips?: () => void
  private unslot?: () => void
  private drawerWidth?: MediaQueryList
  private control?: HTMLButtonElement
  private layer?: HTMLElement
  private menu?: { el: HTMLElement; heading: HTMLElement; close: (focus: boolean) => void }
  private rail = false
  private readonly onWidth = () => this.sync()
  private readonly onClick = (event: Event) => {
    // A folded heading in the rail opens its menu.
    const heading = this.foldOf(event.target)
    if (heading) { this.toggleMenu(heading); return }
    // Choosing a destination in the drawer closes it, as in the Admin.
    if (event.composedPath().some((node) => node instanceof HTMLElement && node !== this && (node.tagName === 'A' || node.tagName === 'BUTTON')))
      setSidebarDrawerOpen(false)
  }
  private readonly onKey = (event: KeyboardEvent) => {
    const heading = this.foldOf(event.target)
    if (heading && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight')) {
      event.preventDefault()
      this.openMenu(heading)
    }
  }

  connectedCallback() {
    ensureRailRowsCss()
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `${shadowCss(platformCss)}
      /* #1253: no fill of its own, and nothing clips the menus its top and foot open. */
      :host { display:block; position:static; z-index:auto; box-sizing:border-box; width:${WIDTH}px; min-width:0; height:100%;
        transition:width 200ms linear; background:transparent !important; overflow:visible !important; }
      /* #1248: collapsed (md+), an icon rail; at phone width the frame is the drawer. */
      :host([data-collapsed]) { width:${RAIL}px; }
      .sidebar-backdrop { display:none; }
      /* #1253 (Quiet Canvas): no fill and no border; it sits on the grey canvas, as
         tall as the window, its links scrolling between the top and the foot. */
      .sidebar-frame { position:sticky; top:var(--featherbase-bar-height, 0px); display:flex; flex-direction:column;
        height:calc(100dvh - var(--featherbase-bar-height, 0px)); box-sizing:border-box;
        color:var(--color-ink); font:14px/1.45 var(--font-sans); }
      .sidebar-links { flex:1; min-height:0; overflow-y:auto; padding:4px 8px; display:flex; flex-direction:column; }
      :host([data-collapsed]) .sidebar-links { overflow-x:hidden; }
      /* A row keeps its height; one with margin-top:auto sits at the foot. */
      ::slotted(*) { flex-shrink:0; }
      ::slotted(button), ::slotted(a) {
        display:flex !important; align-items:center !important; gap:10px !important;
        box-sizing:border-box !important; width:100% !important; min-height:40px !important;
        margin:0 0 4px !important; padding:8px 12px !important; border:0 !important;
        border-radius:var(--radius-control) !important; background:transparent !important;
        color:var(--color-ink) !important; font:inherit !important;
        text-align:left !important; text-decoration:none !important; cursor:pointer;
      }
      /* A group's title (#1253): small, grey, regular weight. */
      ::slotted(:not(button):not(a):not([data-rail-fold])), :host(:not([data-collapsed])) ::slotted([data-rail-fold]) { font-size:12px !important; font-weight:400 !important;
        color:var(--color-ink-muted) !important; text-transform:none !important; letter-spacing:normal !important; }
      :host([data-collapsed]) ::slotted(button), :host([data-collapsed]) ::slotted(a) {
        position:relative !important; justify-content:center !important; width:40px !important; height:40px !important;
        padding:0 !important; margin:0 auto 4px !important; gap:0 !important; }
      ::slotted([data-depth="1"]) { padding-left:40px !important; font-size:13px !important; }
      ::slotted(:is(button, a):hover) { background:color-mix(in srgb, var(--color-border) 50%, transparent) !important; color:var(--color-ink) !important; }
      /* #1253: the open page is a white tile with a soft shadow, in the app's accent. */
      ::slotted([aria-current="page"]) { background:var(--color-surface) !important; color:var(--color-action) !important; font-weight:500 !important;
        box-shadow:0 1px 3px color-mix(in srgb, var(--color-scrim) 10%, transparent), 0 1px 2px -1px color-mix(in srgb, var(--color-scrim) 10%, transparent) !important; }
      ::slotted(:focus-visible) { outline:2px solid var(--color-focus) !important; outline-offset:1px !important; }
      /* #1248: the control is the sidebar's own: a footer row and its edge. */
      .sidebar-foot { padding:8px; }
      .sidebar-collapse { display:flex; align-items:center; gap:10px; width:100%; min-height:36px; padding:6px 8px; box-sizing:border-box;
        border:0; border-radius:var(--radius-control); background:transparent; color:var(--color-ink-muted); font:inherit; cursor:pointer; text-align:left; }
      .sidebar-collapse:hover { background:color-mix(in srgb, var(--color-border) 50%, transparent); color:var(--color-ink); }
      .sidebar-collapse:focus-visible { outline:2px solid var(--color-focus); outline-offset:1px; }
      .sidebar-collapse kbd { margin-left:auto; font:12px var(--font-mono, ui-monospace, monospace); color:var(--color-ink-subtle); }
      :host([data-collapsed]) .sidebar-collapse { width:40px; justify-content:center; padding:0; margin:0 auto; }
      :host([data-collapsed]) .sidebar-collapse .words, :host([data-collapsed]) .sidebar-collapse kbd { display:none; }
      .sidebar-edge { position:absolute; top:0; bottom:0; right:-5px; width:10px; cursor:col-resize; z-index:2; }
      .sidebar-edge::after { content:""; position:absolute; top:0; bottom:0; left:4px; width:2px; background:transparent; transition:background 120ms; }
      .sidebar-edge:hover::after { background:var(--color-action); }
      .featherbase-rail-tip { background:var(--color-ink); color:var(--color-surface); font-size:12px; font-weight:500;
        padding:4px 8px; border-radius:6px; white-space:nowrap; box-shadow:0 2px 8px color-mix(in srgb, var(--color-scrim) 15%, transparent); }
      .rail-menu { position:fixed; z-index:61; min-width:220px; max-height:calc(100vh - 16px); overflow-y:auto; box-sizing:border-box;
        display:flex; flex-direction:column; gap:1px; padding:6px; border:1px solid var(--color-border); border-radius:var(--radius-control);
        background:var(--color-surface); color:var(--color-ink); box-shadow:0 8px 24px color-mix(in srgb, var(--color-scrim) 16%, transparent); font-size:13px; }
      .rail-menu .heading { font-size:12px; color:var(--color-ink-subtle); padding:4px 8px; }
      .rail-menu button { display:flex; justify-content:space-between; gap:12px; padding:7px 8px; border:0; border-radius:7px;
        background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; white-space:nowrap; }
      .rail-menu button:hover, .rail-menu button:focus-visible { background:var(--color-subtle); outline:none; }
      .rail-menu button[aria-current="page"] { font-weight:600; }
      .rail-menu .count { color:var(--color-ink-subtle); font-variant-numeric:tabular-nums; }
      @media (prefers-reduced-motion: reduce) { :host { transition:none; } }
      @media ${SIDEBAR_DRAWER_QUERY} {
        :host { width:0; }
        .sidebar-frame { position:fixed; z-index:40; top:var(--featherbase-bar-height, 48px); bottom:0; left:0;
          box-sizing:border-box; width:${DRAWER_WIDTH}px; height:auto; background:var(--color-canvas);
          transform:translateX(-100%); transition:transform 150ms ease-out; }
        :host([data-open]) .sidebar-frame { transform:none; }
        :host([data-open]) .sidebar-backdrop { display:block; position:fixed; z-index:39; inset:var(--featherbase-bar-height, 48px) 0 0 0;
          background:var(--color-scrim); opacity:.3; }
        ::slotted(button), ::slotted(a) { min-height:44px !important; }
        .sidebar-collapse, .sidebar-edge { display:none; }
      }`
    this.setAttribute('role', 'navigation')
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Application navigation')
    const nav = document.createElement('div')
    nav.className = 'sidebar-frame'
    // #1253: the shared bar draws the switcher at the top and the account at the foot.
    const top = document.createElement('div')
    top.dataset.testid = 'sidebar-slot-top'
    const links = document.createElement('div')
    links.className = 'sidebar-links'
    links.append(document.createElement('slot'))
    const account = document.createElement('div')
    account.dataset.testid = 'sidebar-slot-foot'
    nav.append(top, links)
    const foot = document.createElement('div')
    foot.className = 'sidebar-foot'
    foot.append(account)
    const control = document.createElement('button')
    control.type = 'button'
    control.className = 'sidebar-collapse'
    control.dataset.testid = 'sidebar-collapse'
    // #1251's keyboard-shortcut list finds the control by these.
    control.dataset.shortcutId = 'sidebar'
    control.dataset.shortcutKey = SIDEBAR_SHORTCUT
    control.setAttribute('aria-keyshortcuts', 'Meta+B Control+B')
    control.addEventListener('click', () => toggleSidebarCollapsed(getSignedInUser()?.row_id))
    foot.append(control)
    const edge = document.createElement('div')
    edge.className = 'sidebar-edge'
    edge.dataset.testid = 'sidebar-edge'
    edge.setAttribute('aria-hidden', 'true')
    edge.addEventListener('click', () => toggleSidebarCollapsed(getSignedInUser()?.row_id))
    const layer = document.createElement('div')
    layer.className = 'rail-layer'
    nav.append(foot, edge, layer)
    this.control = control
    this.layer = layer
    // UI-025: on a phone, a backdrop over the page closes the drawer.
    const backdrop = document.createElement('div')
    backdrop.className = 'sidebar-backdrop'
    backdrop.dataset.testid = 'sidebar-backdrop'
    backdrop.addEventListener('click', () => setSidebarDrawerOpen(false))
    shadow.replaceChildren(style, backdrop, nav)

    this.leave?.()
    this.unsubscribe?.()
    this.unslot?.()
    this.unslot = offerSidebarSlots({ top, foot: account })
    this.leave = registerSidebar(getSignedInUser()?.row_id)
    this.unsubscribe = subscribeSidebar(this.onWidth)
    this.drawerWidth = typeof window.matchMedia === 'function' ? window.matchMedia(SIDEBAR_DRAWER_QUERY) : undefined
    this.drawerWidth?.addEventListener?.('change', this.onWidth)
    this.addEventListener('click', this.onClick)
    this.addEventListener('keydown', this.onKey)
    this.untips?.()
    this.untips = attachRailTips({
      root: this, layer,
      active: () => this.rail,
      rowOf: (target) => {
        const row = target instanceof Element ? target.closest('featherbase-sidebar > *') as HTMLElement | null : null
        return row && row.parentElement === this && (row.matches('button, a') || row.hasAttribute('data-rail-fold')) && !this.menu ? row : null
      },
    })
    // The app redraws its rows (a new report, a changed count): the rail marks follow.
    this.rowsObserver?.disconnect()
    this.rowsObserver = new MutationObserver(() => { if (this.rail) this.markRows(true) })
    this.rowsObserver.observe(this, { childList: true, subtree: true, characterData: true })
    this.sync()

    // Observe the platform bar, not the app document: switching navigation's
    // theme must never restyle content owned by the app.
    const host = document.querySelector<HTMLElement>('featherbase-bar')
    const bar = host?.shadowRoot
    // #941 (ADR 0019): the app's accent goes on the element that carries the
    // painted theme, so the accent's dark block matches after a switch.
    const accent = host?.dataset.accent ?? document.documentElement.getAttribute(APP_ACCENT_ATTRIBUTE)
    if (accent) nav.setAttribute(APP_ACCENT_ATTRIBUTE, accent)
    const syncTheme = () => {
      const theme = bar?.querySelector<HTMLElement>('[data-testid=bar-theme-root]')?.dataset.theme
      if (theme) nav.dataset.theme = theme
    }
    syncTheme()
    if (bar) {
      this.themeObserver = new MutationObserver(syncTheme)
      this.themeObserver.observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-theme'] })
    }
  }

  /** Draws the shared state: collapsed (md+) is the rail; at phone width the
   *  drawer, which is out of the tab order and the accessibility tree while shut. */
  private sync() {
    const state = readSidebar(getSignedInUser()?.row_id)
    const drawer = Boolean(this.drawerWidth?.matches)
    const collapsed = state.collapsed && !drawer
    const open = drawer && state.drawerOpen
    this.toggleAttribute('data-collapsed', collapsed)
    this.toggleAttribute('data-open', open)
    const hidden = drawer && !open
    this.inert = hidden
    if (hidden) this.setAttribute('aria-hidden', 'true')
    else this.removeAttribute('aria-hidden')
    if (this.control) {
      const words = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
      this.control.setAttribute('aria-label', words)
      this.control.title = `${words} (${SIDEBAR_SHORTCUT})`
      this.control.innerHTML = collapsed ? EXPAND_ICON : `${COLLAPSE_ICON}<span class="words">Collapse</span><kbd>${SIDEBAR_SHORTCUT}</kbd>`
    }
    if (this.rail !== collapsed) {
      this.rail = collapsed
      this.menu?.close(false)
      this.markRows(collapsed)
    }
  }

  /** The rail's marks on the app's rows: initials where a row has no icon of
   *  its own (or asks for them), a zero count without a badge, and a folding
   *  heading made a button. Taken off again when the sidebar opens. */
  private markRows(rail: boolean) {
    this.rowsObserver?.disconnect()
    for (const row of Array.from(this.children) as HTMLElement[]) {
      if (row.matches('button, a')) {
        const mark = rail && (row.hasAttribute('data-rail-initials') || !row.querySelector('svg')) ? railMark(rowLabel(row)) : ''
        if (mark) row.setAttribute('data-rail-mark', mark)
        else row.removeAttribute('data-rail-mark')
        row.querySelectorAll('[data-sidebar-count]').forEach((count) => count.toggleAttribute('data-rail-zero', rail && rowCount(row) === '0'))
      } else if (row.hasAttribute('data-rail-fold')) {
        if (rail) {
          row.setAttribute('role', 'button')
          row.setAttribute('tabindex', '0')
          row.setAttribute('aria-haspopup', 'menu')
          row.setAttribute('aria-expanded', 'false')
          row.removeAttribute('aria-label')
          row.setAttribute('aria-label', rowLabel(row))
        } else for (const name of ['role', 'tabindex', 'aria-haspopup', 'aria-expanded', 'aria-label']) row.removeAttribute(name)
      }
    }
    this.rowsObserver?.observe(this, { childList: true, subtree: true, characterData: true })
  }

  private foldOf(target: EventTarget | null): HTMLElement | null {
    if (!this.rail || !(target instanceof Element)) return null
    const heading = target.closest('[data-rail-fold]') as HTMLElement | null
    return heading && heading.parentElement === this ? heading : null
  }

  /** The nested rows a folded heading stands for: those after it, up to the next row that is not nested. */
  private foldedRows(heading: HTMLElement): HTMLElement[] {
    const rows: HTMLElement[] = []
    for (let next = heading.nextElementSibling; next; next = next.nextElementSibling) {
      if (!next.matches('[data-depth="1"]')) break
      rows.push(next as HTMLElement)
    }
    return rows
  }

  private toggleMenu(heading: HTMLElement) {
    if (this.menu?.heading === heading) this.menu.close(false)
    else this.openMenu(heading)
  }

  private openMenu(heading: HTMLElement) {
    this.menu?.close(false)
    // Connected, the element always has its layer. The menu takes the tooltip's place beside the heading.
    const layer = this.layer!
    layer.querySelector('.featherbase-rail-tip')?.remove()
    const label = rowLabel(heading)
    const menu = document.createElement('div')
    menu.className = 'rail-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', label)
    const title = document.createElement('div')
    title.className = 'heading'
    title.textContent = label
    title.setAttribute('aria-hidden', 'true')
    menu.append(title)
    const items = this.foldedRows(heading).map((row) => {
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
    menu.append(...items)
    const close = (focus: boolean) => {
      menu.remove()
      heading.setAttribute('aria-expanded', 'false')
      document.removeEventListener('pointerdown', outside, true)
      if (this.menu?.el === menu) this.menu = undefined
      if (focus) heading.focus()
    }
    const outside = (event: Event) => {
      if (!event.composedPath().includes(menu) && !event.composedPath().includes(heading)) close(false)
    }
    menu.addEventListener('keydown', (event) => {
      const at = items.indexOf((this.shadowRoot?.activeElement ?? null) as HTMLButtonElement)
      if (event.key === 'Escape' || event.key === 'ArrowLeft') { event.preventDefault(); close(true) }
      else if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus() }
      else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus() }
      else if (event.key === 'Tab') close(false)
    })
    layer.append(menu)
    const place = railMenuPlace(heading, menu.getBoundingClientRect().height)
    menu.style.left = `${place.left}px`
    menu.style.top = `${place.top}px`
    heading.setAttribute('aria-expanded', 'true')
    document.addEventListener('pointerdown', outside, true)
    this.menu = { el: menu, heading, close }
    items[0]?.focus()
  }

  disconnectedCallback() {
    this.menu?.close(false)
    this.themeObserver?.disconnect()
    this.rowsObserver?.disconnect()
    this.untips?.()
    this.untips = undefined
    this.unslot?.()
    this.unslot = undefined
    this.drawerWidth?.removeEventListener?.('change', this.onWidth)
    this.removeEventListener('click', this.onClick)
    this.removeEventListener('keydown', this.onKey)
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.leave?.()
    this.leave = undefined
  }
}
