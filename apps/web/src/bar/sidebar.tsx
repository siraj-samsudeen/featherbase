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
 *  window, and at phone width the drawer. The app's rows are styled here too, as
 *  the Admin's rows are (::slotted reaches them from the shadow). */
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
      /* #1248: the frame's edge toggles it too. */
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
        .sidebar-edge { display:none; }
      }`

/** Apps supply direct buttons/links and keep their own handlers and state.
 *  The platform owns the navigation frame, row presentation and, since #1227,
 *  the frame's behaviour, the same as the Admin's sidebar: its width, the
 *  collapsed choice (its own footer and edge, and Ctrl/Cmd+B), and the drawer
 *  over the page at phone width. The app gives it an `auto` column.
 *
 *  #1385 (slice 3): the frame is the Admin's own component (SidebarAside),
 *  rendered with React in this element's shadow root; the app's rows stay in the
 *  light DOM, projected through its `<slot>`. Their rail behaviour (#1248:
 *  `data-rail-initials`, `data-sidebar-count`, `data-rail-fold` headings over
 *  `data-depth="1"` rows) is bar/app-rows.ts. */
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
      <SidebarAside testid="app-sidebar" user={getSignedInUser()?.row_id} app={{ host: this, theme, accent: this.accent }}>
        <slot />
      </SidebarAside>,
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
