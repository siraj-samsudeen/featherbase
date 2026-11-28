import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { APP_ACCENT_ATTRIBUTE } from '@featherbase/shop-floor/theme'
import platformCss from '../index.css?inline'
import { shadowCss } from './style'
import { getSignedInUser } from '../lib/api'
import { SIDEBAR_DRAWER_QUERY } from '../lib/sidebar-collapsed'
import { SidebarAside } from '../components/SidebarAside'
import { attachPickersHost, type PickersHost } from './pickers-host'

/** Admin's sidebar widths (SidebarAside: md:w-60, the rail md:w-14, a w-64 drawer), for every app (#1227, #1248). */
const WIDTH = 240
const RAIL = 56
const DRAWER_WIDTH = 256

/** Where the shared frame sits on an app's page: the element is its box, in the
 *  column the app gives it; the frame is sticky below the bar, as tall as the
 *  window, and at phone width the drawer. */
const FRAME_CSS =`
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
      /* #1248: the frame's edge toggles it too. */
      .sidebar-edge { position:absolute; top:0; bottom:0; right:-5px; width:10px; cursor:col-resize; z-index:2; }
      .sidebar-edge::after { content:""; position:absolute; top:0; bottom:0; left:4px; width:2px; background:transparent; transition:background 120ms; }
      .sidebar-edge:hover::after { background:var(--color-action); }
      .featherbase-rail-tip { background:var(--color-ink); color:var(--color-surface); font-size:12px; font-weight:500;
        padding:4px 8px; border-radius:6px; white-space:nowrap; box-shadow:0 2px 8px color-mix(in srgb, var(--color-scrim) 15%, transparent); }
      @media (prefers-reduced-motion: reduce) { :host { transition:none; } }
      @media ${SIDEBAR_DRAWER_QUERY} {
        :host { width:0; }
        .sidebar-frame { position:fixed; z-index:40; top:var(--featherbase-bar-height, 48px); bottom:0; left:0;
          box-sizing:border-box; width:${DRAWER_WIDTH}px; height:auto; background:var(--color-canvas);
          transform:translateX(-100%); transition:transform 150ms ease-out; }
        :host([data-open]) .sidebar-frame { transform:none; }
        :host([data-open]) .sidebar-backdrop { display:block; position:fixed; z-index:39; inset:var(--featherbase-bar-height, 48px) 0 0 0;
          background:var(--color-scrim); opacity:.3; }
        .sidebar-edge { display:none; }
      }`

/** #1253 (Quiet Canvas): beside the sidebar, the app's page is one white panel on
 *  the grey canvas, set off by a soft shadow, 8px from the window's edges. The gap
 *  wins over an app's own margin on its page (Dash centres it with auto). It lives
 *  in the app's document, scoped to this element's name. */
const PANEL_CSS = `
@media (width >= 48rem) {
  featherbase-sidebar + * { background:var(--color-surface); border-radius:12px; margin:8px 8px 8px 0 !important; width:auto !important; min-width:0;
    box-shadow:0 1px 3px color-mix(in srgb, var(--color-scrim) 10%, transparent), 0 1px 2px -1px color-mix(in srgb, var(--color-scrim) 10%, transparent); }
}
`

function ensurePanelCss() {
  if (document.getElementById('featherbase-sidebar-panel')) return
  const style = document.createElement('style')
  style.id = 'featherbase-sidebar-panel'
  style.textContent = PANEL_CSS
  document.head.append(style)
}

/** #1385 (slice 4): an app places this element, empty, in an `auto` column of
 *  its page, and gives its rows as data (the manifest's `sidebar` and
 *  setSidebarRows): it never draws them. The platform owns the navigation frame,
 *  the rows and, since #1227,
 *  the frame's behaviour, the same as the Admin's sidebar: its width, the
 *  collapsed choice (its own footer and edge, and Ctrl/Cmd+B), and the drawer
 *  over the page at phone width. The app gives it an `auto` column.
 *
 *  #1385 (slice 3): the frame is the Admin's own component (SidebarAside),
 *  rendered with React in this element's shadow root, and the rows are the
 *  Admin's own (SidebarSections), drawn there by the shared bar. */
export class FeatherbaseSidebar extends HTMLElement {
  private root?: Root
  private pickers?: PickersHost
  private themeObserver?: MutationObserver
  private accent?: string | null

  connectedCallback() {
    this.setAttribute('role', 'navigation')
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Application navigation')
    if (!this.root) {
      const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = `${shadowCss(platformCss)}${FRAME_CSS}`
      const container = document.createElement('div')
      container.style.display = 'contents'
      shadow.replaceChildren(style, container)
      this.root = createRoot(container)
    }
    this.pickers?.detach()
    this.pickers = attachPickersHost(this)
    ensurePanelCss()

    // Observe the platform bar, not the app document: switching navigation's
    // theme must never restyle content owned by the app.
    const host = document.querySelector<HTMLElement>('featherbase-bar')
    const bar = host?.shadowRoot
    // #941 (ADR 0019): the app's accent goes on the element that carries the
    // painted theme, so the accent's dark block matches after a switch.
    this.accent = host?.dataset.accent ?? document.documentElement.getAttribute(APP_ACCENT_ATTRIBUTE)
    const syncTheme = () => this.draw(bar?.querySelector<HTMLElement>('[data-testid=bar-theme-root]')?.dataset.theme)
    syncTheme()
    this.themeObserver?.disconnect()
    if (bar) {
      this.themeObserver = new MutationObserver(syncTheme)
      this.themeObserver.observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-theme'] })
    }
  }

  /** Drawn at once, so the app's first paint already has its sidebar. */
  private draw(theme: string | undefined) {
    this.pickers?.paint(theme, this.accent)
    const root = this.root!
    flushSync(() => root.render(
      <SidebarAside testid="app-sidebar" user={getSignedInUser()?.row_id} app={{ host: this, theme, accent: this.accent }} />,
    ))
  }

  disconnectedCallback() {
    this.themeObserver?.disconnect()
    this.themeObserver = undefined
    this.pickers?.detach()
    this.pickers = undefined
    // Moved within the page, the element is connected again at once and keeps its frame.
    queueMicrotask(() => {
      if (this.isConnected || !this.root) return
      this.root.unmount()
      this.root = undefined
    })
  }
}
