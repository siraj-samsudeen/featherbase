import { APP_ACCENT_ATTRIBUTE } from '@featherbase/shop-floor/theme'
import platformCss from '../index.css?inline'
import { shadowCss } from './style'
import { offerPickerSlot } from '../lib/sidebar-collapsed'

/** #1253 (Siraj, 17-Nov): the app's declared pickers sit inside its white
 *  panel, at the top and right-aligned: a host the platform keeps as the first
 *  child of the app's page column (the sidebar's next sibling), styled in its
 *  own shadow. Only an app that declares pickers gets the host in its page
 *  column; an app's own React tree is left untouched otherwise (Tasker's tour). */
export interface PickersHost {
  /** The painted theme and the app's accent, as the sidebar's frame carries them. */
  paint(theme: string | undefined, accent: string | null | undefined): void
  detach(): void
}

export function attachPickersHost(sidebar: HTMLElement): PickersHost {
  const host = document.createElement('div')
  host.dataset.featherbasePickers = ''
  const pickerShadow = host.attachShadow({ mode: 'open' })
  const pickerStyle = document.createElement('style')
  pickerStyle.textContent = `${shadowCss(platformCss)}
    :host { display:block; }
    .pickers-root { color:var(--color-ink); font:14px/1.45 var(--font-sans); }
    .pickers-root:empty { display:none; }
    .pickers-root:not(:empty) { padding:12px 16px 0; }`
  const root = document.createElement('div')
  root.className = 'pickers-root'
  root.dataset.testid = 'page-picker-slot'
  pickerShadow.append(pickerStyle, root)

  /** Keeps the pickers host first in the app's page column. */
  const place = () => {
    const panel = sidebar.nextElementSibling as HTMLElement | null
    if (!root.firstChild) host.remove()
    else if (panel && panel.firstChild !== host) {
      panelObserver.disconnect()
      panel.prepend(host)
      panelObserver.observe(sidebar.parentElement!, { childList: true, subtree: false })
      panelObserver.observe(panel, { childList: true, subtree: false })
    }
  }
  const pickersObserver = new MutationObserver(place)
  pickersObserver.observe(root, { childList: true })
  const unoffer = offerPickerSlot(root)
  const panelObserver = new MutationObserver(place)
  place()
  if (sidebar.parentElement) panelObserver.observe(sidebar.parentElement, { childList: true, subtree: false })

  return {
    paint(theme, accent) {
      if (accent) root.setAttribute(APP_ACCENT_ATTRIBUTE, accent)
      if (theme) root.dataset.theme = theme
    },
    detach() {
      unoffer()
      panelObserver.disconnect()
      pickersObserver.disconnect()
      host.remove()
    },
  }
}
