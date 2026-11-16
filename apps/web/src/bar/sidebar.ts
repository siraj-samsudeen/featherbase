import { APP_ACCENT_ATTRIBUTE } from '@featherbase/shop-floor/theme'
import platformCss from '../index.css?inline'
import { shadowCss } from './style'
import { getSessionUser } from '../lib/api'
import { SIDEBAR_DRAWER_QUERY, readSidebar, registerSidebar, setSidebarDrawerOpen, subscribeSidebar } from '../lib/sidebar-collapsed'

/** Admin's sidebar widths (AdminLayout: md:w-60, a w-64 drawer), for every app (#1227). */
const WIDTH = 240
const DRAWER_WIDTH = 256

/** Apps supply direct buttons/links and keep their own handlers and state.
 *  The platform owns the navigation frame, row presentation and, since #1227,
 *  the frame's behaviour, the same as the Admin's sidebar: its width, the
 *  collapsed choice (the top bar's control and Ctrl/Cmd+B), and the drawer
 *  over the page at phone width. The app gives it an `auto` column. */
export class FeatherbaseSidebar extends HTMLElement {
  private themeObserver?: MutationObserver
  private leave?: () => void
  private unsubscribe?: () => void
  private drawerWidth?: MediaQueryList
  private readonly onWidth = () => this.sync()
  private readonly onClick = (event: Event) => {
    // Choosing a destination in the drawer closes it, as in the Admin.
    if (event.composedPath().some((node) => node instanceof HTMLElement && node !== this && (node.tagName === 'A' || node.tagName === 'BUTTON')))
      setSidebarDrawerOpen(false)
  }

  connectedCallback() {
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `${shadowCss(platformCss)}
      :host { display:block; position:static; z-index:auto; box-sizing:border-box; width:${WIDTH}px; min-width:0; height:100%; }
      /* Collapsed (md+) the sidebar gives the page its width; at phone width
         it stays in the page's grid with no width, and its frame is the drawer. */
      :host([data-collapsed]) { width:0; overflow:hidden; }
      :host([data-collapsed]) .sidebar-frame { display:none; }
      .sidebar-backdrop { display:none; }
      .sidebar-frame { display:flex; flex-direction:column; min-height:calc(100vh - var(--featherbase-bar-height, 48px)); height:100%; padding:12px;
        border-right:1px solid var(--color-border); background:var(--color-surface);
        color:var(--color-ink); font:14px/1.45 var(--font-sans); }
      /* A row keeps its height; one with margin-top:auto sits at the foot. */
      ::slotted(*) { flex-shrink:0; }
      ::slotted(button), ::slotted(a) {
        display:flex !important; align-items:center !important; gap:10px !important;
        box-sizing:border-box !important; width:100% !important; min-height:40px !important;
        margin:0 0 4px !important; padding:8px 12px !important; border:0 !important;
        border-radius:var(--radius-control) !important; background:transparent !important;
        color:var(--color-ink-muted) !important; font:inherit !important;
        text-align:left !important; text-decoration:none !important; cursor:pointer;
      }
      ::slotted([data-depth="1"]) { padding-left:40px !important; font-size:13px !important; }
      ::slotted(:hover) { background:var(--color-subtle) !important; color:var(--color-ink) !important; }
      ::slotted([aria-current="page"]) { background:var(--color-action-tint) !important;
        color:var(--color-action) !important; font-weight:600 !important; }
      ::slotted(:focus-visible) { outline:2px solid var(--color-focus) !important; outline-offset:1px !important; }
      @media ${SIDEBAR_DRAWER_QUERY} {
        :host { width:0; }
        .sidebar-frame { position:fixed; z-index:40; top:var(--featherbase-bar-height, 48px); bottom:0; left:0;
          box-sizing:border-box; width:${DRAWER_WIDTH}px; min-height:0; overflow-y:auto;
          transform:translateX(-100%); transition:transform 150ms ease-out; }
        :host([data-open]) .sidebar-frame { transform:none; box-shadow:0 8px 24px rgb(0 0 0 / .18); }
        :host([data-open]) .sidebar-backdrop { display:block; position:fixed; z-index:39; inset:var(--featherbase-bar-height, 48px) 0 0 0;
          background:var(--color-scrim, #000); opacity:.3; }
        ::slotted(button), ::slotted(a) { min-height:44px !important; }
      }`
    this.setAttribute('role', 'navigation')
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Application navigation')
    const nav = document.createElement('div')
    nav.className = 'sidebar-frame'
    nav.append(document.createElement('slot'))
    // UI-025: on a phone, a backdrop over the page closes the drawer.
    const backdrop = document.createElement('div')
    backdrop.className = 'sidebar-backdrop'
    backdrop.dataset.testid = 'sidebar-backdrop'
    backdrop.addEventListener('click', () => setSidebarDrawerOpen(false))
    shadow.replaceChildren(style, backdrop, nav)

    this.leave?.()
    this.unsubscribe?.()
    this.leave = registerSidebar(getSessionUser()?.row_id)
    this.unsubscribe = subscribeSidebar(this.onWidth)
    this.drawerWidth = typeof window.matchMedia === 'function' ? window.matchMedia(SIDEBAR_DRAWER_QUERY) : undefined
    this.drawerWidth?.addEventListener?.('change', this.onWidth)
    this.addEventListener('click', this.onClick)
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

  /** Draws the shared state: collapsed only at md+, open only as a drawer.
   *  What is hidden is out of the tab order and the accessibility tree. */
  private sync() {
    const state = readSidebar(getSessionUser()?.row_id)
    const drawer = Boolean(this.drawerWidth?.matches)
    const collapsed = state.collapsed && !drawer
    const open = drawer && state.drawerOpen
    this.toggleAttribute('data-collapsed', collapsed)
    this.toggleAttribute('data-open', open)
    const hidden = collapsed || (drawer && !open)
    this.inert = hidden
    if (hidden) this.setAttribute('aria-hidden', 'true')
    else this.removeAttribute('aria-hidden')
  }

  disconnectedCallback() {
    this.themeObserver?.disconnect()
    this.drawerWidth?.removeEventListener?.('change', this.onWidth)
    this.removeEventListener('click', this.onClick)
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.leave?.()
    this.leave = undefined
  }
}
