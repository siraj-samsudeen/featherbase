// #1409 (design D6): a page that received stand-in rows says so. The server
// names the stand-ins a response carried in one header (shared stand-in.ts);
// this wraps the page's fetch, once, reads that header off every same-site
// `/api/...` answer and remembers it, so the page shell can draw one line
// under the top bar (components/StandInLine.tsx). Installed by both page
// entries, like the deploy wait beside it: the platform's (main.tsx) and the
// shared bar every app page loads (bar/main.tsx), so an app shows the line
// with no code of its own.
import { useMemo, useSyncExternalStore } from 'react'
import { STAND_IN_HEADER, readStandInHeader, type StandInServed } from 'shared'

/** The Datasets page, where a System Manager sees and switches a stand-in. */
export const DATASETS_PATH = '/featherbase/admin/datasets'

type Fetch = typeof globalThis.fetch
/** What one page was last told: request → the stand-ins its answer carried. */
type PageStandIns = ReadonlyMap<string, readonly StandInServed[]>

// Page pathname → request → stand-ins. A request is its method, API address
// and body text, so a page's second read of the same thing replaces what the
// first said: that is how the line goes after a switch to the warehouse. It is
// kept per pathname because an app keeps what it read: going back to a page
// whose rows it cached asks nothing, and the line must still be there. The map
// is replaced, never changed in place, so React sees each change.
//
// It is kept on the window, not in this module. In development the bar's
// script is a stub (vite.config.ts) that installs the wrapper before it loads
// the bar's entry, and Vite can hand the two a different copy of this module
// (an edited module gets a new address). Both must remember in one place, or
// the wrapper would fill a store the line never reads.
interface Remembered {
  pages: ReadonlyMap<string, PageStandIns>
  listeners: Set<() => void>
}
const REMEMBERED = Symbol.for('featherbase.stand-ins')
const remembered = ((globalThis as unknown as Record<symbol, Remembered>)[REMEMBERED] ??= { pages: new Map(), listeners: new Set() })

function remember(pages: ReadonlyMap<string, PageStandIns>): void {
  remembered.pages = pages
  for (const listener of remembered.listeners) listener()
}

/** Remember what one answer said, under the page that received it. */
export function recordStandIns(pathname: string, request: string, served: readonly StandInServed[]): void {
  const before = remembered.pages.get(pathname)?.get(request)
  if (JSON.stringify(before ?? []) === JSON.stringify(served)) return
  const page = new Map(remembered.pages.get(pathname))
  if (served.length) page.set(request, served)
  else page.delete(request)
  const next = new Map(remembered.pages)
  if (page.size) next.set(pathname, page)
  else next.delete(pathname)
  remember(next)
}

/** Forget every page: a test starts each case with nothing remembered. */
export function forgetStandIns(): void {
  remember(new Map())
}

/** The stand-ins a page received, each dataset once (its latest load), in name order. */
export function standInsOn(page: PageStandIns | undefined): StandInServed[] {
  const byDataset = new Map<string, StandInServed>()
  for (const served of page?.values() ?? [])
    for (const standIn of served) {
      const key = `${standIn.app}.${standIn.dataset}`
      const known = byDataset.get(key)
      if (!known || known.loaded_at < standIn.loaded_at) byDataset.set(key, standIn)
    }
  return [...byDataset.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, standIn]) => standIn)
}

const subscribe = (listener: () => void) => {
  remembered.listeners.add(listener)
  return () => { remembered.listeners.delete(listener) }
}

/** The stand-ins the page at `pathname` received. The caller names the page:
 *  each shell already follows its own address (the Admin's router; the
 *  document's address over an app's page). */
export function useStandIns(pathname: string): StandInServed[] {
  const page = useSyncExternalStore(subscribe, () => remembered.pages.get(pathname))
  return useMemo(() => standInsOn(page), [page])
}

/** `base`, except that every same-site `/api/...` answer has its stand-in
 *  header read and remembered under the page the document is on when the
 *  answer arrives. The answer is passed on untouched: a header is read
 *  without consuming the body. An error answer carried no rows, so it says
 *  nothing about the rows already on screen and clears nothing. */
export function markStandIns(base: Fetch, record: typeof recordStandIns = recordStandIns): Fetch {
  return async function fetchMarkingStandIns(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const answer = await base(input, init)
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return answer
    const served = readStandInHeader(answer.headers.get(STAND_IN_HEADER))
    if (!answer.ok && !served.length) return answer
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : ''
    record(window.location.pathname, `${method} ${url.pathname}${url.search} ${body}`, served)
    return answer
  }
}

const INSTALLED = Symbol.for('featherbase.stand-in-mark')

/** Wrap the page's fetch (once), so every answer's stand-ins are remembered. */
export function installStandInMark(win: Window & typeof globalThis): void {
  const marked = win as unknown as Record<symbol, boolean>
  if (marked[INSTALLED]) return
  marked[INSTALLED] = true
  win.fetch = markStandIns(win.fetch.bind(win))
}
