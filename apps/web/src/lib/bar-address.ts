import { createContext, useContext, useEffect, useState } from 'react'

// #650 (design E8): a bar control keeps its value in the address
// (`?<sets>=<value>`), and every choice is also announced to the page as one
// documented browser event, so an app's own page can follow a choice without
// watching its address:
//
//   window.addEventListener('featherbase:bar-change', (event) => {
//     const { key, value } = event.detail   // e.g. { key: 'store', value: 'S103' }
//   })
//
// On load, an app reads the same value from `location.search`; a page opened
// with no valid choice gets the first option written in place (no Back step),
// announced once. The event is
// fired after the address has changed, on `window`, once per choice; moving
// through history (the back button) fires the browser's own `popstate` only.

/** The browser event a bar choice is announced with. */
export const BAR_CHANGE_EVENT = 'featherbase:bar-change'

/** What a bar-change event carries: the control's key and its new value. */
export interface BarChange {
  key: string
  value: string
}

export function announceBarChange(key: string, value: string) {
  window.dispatchEvent(new CustomEvent<BarChange>(BAR_CHANGE_EVENT, { detail: { key, value } }))
}

/** Where a bar control reads and writes its value. Unset, the Admin's router
 *  is the address; on an app's own page the bar is given the document's own
 *  history instead, so it never drives the app's navigation. */
export interface BarAddress {
  search: string
  /** A new history entry, or with `replace` the current one rewritten. */
  set: (key: string, value: string, opts?: { replace?: boolean }) => void
}

export const BarAddressContext = createContext<BarAddress | null>(null)

export function useBarAddress(): BarAddress | null {
  return useContext(BarAddressContext)
}

// An app may move its own address (`history.pushState` / `replaceState`),
// changing or dropping a bar control's key; the browser announces neither. So
// the bar wraps the two, once, to hear of each write: the wrapper calls the
// browser's own method unchanged and then tells the bar (Codex round 1 on
// #658). The notice is private to the bar; the page sees no new event.
const historyWrites = new EventTarget()
let watchingHistory = false
function watchHistoryWrites() {
  if (watchingHistory) return
  watchingHistory = true
  for (const method of ['pushState', 'replaceState'] as const) {
    const browsers = window.history[method]
    window.history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = browsers.apply(this, args)
      historyWrites.dispatchEvent(new Event('write'))
      return result
    }
  }
}

/** The document's own address, followed through the browser's history and
 *  the app's own history writes. A choice is a new history entry in the same
 *  document, never a reload. */
export function useDocumentAddress(): BarAddress {
  const [search, setSearch] = useState(window.location.search)
  useEffect(() => {
    watchHistoryWrites()
    const follow = () => setSearch(window.location.search)
    follow()
    window.addEventListener('popstate', follow)
    historyWrites.addEventListener('write', follow)
    return () => {
      window.removeEventListener('popstate', follow)
      historyWrites.removeEventListener('write', follow)
    }
  }, [])
  function set(key: string, value: string, { replace = false } = {}) {
    const url = new URL(window.location.href)
    url.searchParams.set(key, value)
    const href = `${url.pathname}${url.search}${url.hash}`
    // In place, the entry keeps the app's own history state.
    if (replace) window.history.replaceState(window.history.state, '', href)
    else window.history.pushState(null, '', href)
    setSearch(url.search)
  }
  return { search, set }
}
