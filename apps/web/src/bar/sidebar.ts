import { APP_ACCENT_ATTRIBUTE } from '@featherbase/shop-floor/theme'
import platformCss from '../index.css?inline'
import { shadowCss } from './style'
import { getSignedInUser } from '../lib/api'
import { SIDEBAR_DRAWER_QUERY, SIDEBAR_SHORTCUT, offerSidebarSlots, readSidebar, registerSidebar, setSidebarDrawerOpen, subscribeSidebar, toggleSidebarCollapsed } from '../lib/sidebar-collapsed'
import { attachRailTips } from '../lib/sidebar-rail'
import { attachAppRows, type AppRows } from './app-rows'
import { attachPickersHost, type PickersHost } from './pickers-host'

/** Admin's sidebar widths (AdminLayout: md:w-60, the rail md:w-14, a w-64 drawer), for every app (#1227, #1248). */
const WIDTH = 240
const RAIL = 56
const DRAWER_WIDTH = 256

const COLLAPSE_ICON = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/></svg>'
const EXPAND_ICON = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 17 5-5-5-5M6 17l5-5-5-5"/></svg>'

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
  private leave?: () => void
  private unsubscribe?: () => void
  private untips?: () => void
  private unslot?: () => void
  private pickers?: PickersHost
  private rows?: AppRows
  private drawerWidth?: MediaQueryList
  private control?: HTMLButtonElement
  private readonly onWidth = () => this.sync()
  connectedCallback() {
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
      /* #1385: the platform's groups, drawn as in the Admin's sidebar, which has no padding of its own. */
      .sidebar-defaults { flex-shrink:0; margin:0 -8px; }
      ::slotted(button), ::slotted(a) {
        display:flex !important; align-items:center !important; gap:10px !important;
        box-sizing:border-box !important; width:100% !important; min-height:40px !important;
        margin:0 0 4px !important; padding:8px 12px !important; border:0 !important;
        border-radius:var(--radius-control) !important; background:transparent !important;
        color:var(--color-ink) !important; font:inherit !important;
        text-align:left !important; text-decoration:none !important; cursor:pointer;
      }
      /* A group's title (#1253): small, grey, regular weight. */
      /* Open only: in the rail a heading is a gap (the document's rail rules), and a
         shadow's !important would win over them. */
      :host(:not([data-collapsed])) ::slotted(:not(button):not(a)) { font-size:12px !important; font-weight:400 !important;
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
    // #1385 (slice 2): the platform's defaults follow the app's own rows.
    const defaults = document.createElement('div')
    defaults.className = 'sidebar-defaults'
    defaults.dataset.testid = 'sidebar-slot-defaults'
    links.append(document.createElement('slot'), defaults)
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
    // UI-025: on a phone, a backdrop over the page closes the drawer.
    const backdrop = document.createElement('div')
    backdrop.className = 'sidebar-backdrop'
    backdrop.dataset.testid = 'sidebar-backdrop'
    backdrop.addEventListener('click', () => setSidebarDrawerOpen(false))
    shadow.replaceChildren(style, backdrop, nav)

    this.leave?.()
    this.unsubscribe?.()
    this.unslot?.()
    this.unslot = offerSidebarSlots({ top, foot: account, defaults })
    this.pickers?.detach()
    this.pickers = attachPickersHost(this)
    this.rows?.detach()
    this.rows = attachAppRows(this, layer)
    this.leave = registerSidebar(getSignedInUser()?.row_id)
    this.unsubscribe = subscribeSidebar(this.onWidth)
    this.drawerWidth = typeof window.matchMedia === 'function' ? window.matchMedia(SIDEBAR_DRAWER_QUERY) : undefined
    this.drawerWidth?.addEventListener?.('change', this.onWidth)
    this.untips?.()
    this.untips = attachRailTips({
      root: this, layer,
      active: () => this.hasAttribute('data-collapsed'),
      rowOf: (target) => this.rows!.rowOf(target),
    })
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
      this.pickers?.paint(theme, accent)
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
      // #1251: hover text in Title Case, the key after " · ".
      this.control.title = `${collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'} · ${SIDEBAR_SHORTCUT}`
      this.control.innerHTML = collapsed ? EXPAND_ICON : `${COLLAPSE_ICON}<span class="words">Collapse</span><kbd>${SIDEBAR_SHORTCUT}</kbd>`
    }
    this.rows?.setRail(collapsed)
  }

  disconnectedCallback() {
    this.rows?.detach()
    this.rows = undefined
    this.themeObserver?.disconnect()
    this.untips?.()
    this.untips = undefined
    this.unslot?.()
    this.unslot = undefined
    this.pickers?.detach()
    this.pickers = undefined
    this.drawerWidth?.removeEventListener?.('change', this.onWidth)
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.leave?.()
    this.leave = undefined
  }
}
