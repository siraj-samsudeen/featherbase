import { APP_ACCENT_ATTRIBUTE } from '@featherbase/shop-floor/theme'
import platformCss from '../index.css?inline'
import { shadowCss } from './style'

/** Apps supply direct buttons/links and keep their own handlers and state.
 *  The platform owns only the navigation frame and row presentation. */
export class FeatherbaseSidebar extends HTMLElement {
  private themeObserver?: MutationObserver

  connectedCallback() {
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `${shadowCss(platformCss)}
      :host { position:static; z-index:auto; min-width:0; height:100%; }
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
      @media (max-width:700px) {
        .sidebar-frame { display:block; min-height:0; border-right:0; border-bottom:1px solid var(--color-border); }
        slot { display:flex; overflow-x:auto; }
        ::slotted(button), ::slotted(a) { width:auto !important; flex:0 0 auto; min-height:44px !important; }
      }`
    this.setAttribute('role', 'navigation')
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Application navigation')
    const nav = document.createElement('div')
    nav.className = 'sidebar-frame'
    nav.append(document.createElement('slot'))
    shadow.replaceChildren(style, nav)

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

  disconnectedCallback() { this.themeObserver?.disconnect() }
}
