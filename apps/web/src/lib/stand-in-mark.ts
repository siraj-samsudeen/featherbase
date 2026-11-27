// #1409 (design D6): a page that received stand-in rows says so. The server
// names the stand-ins a response carried in one header (shared stand-in.ts);
// this watches the page's requests, reads that header off every same-site
// `/api/...` answer and remembers it, so the page shell can draw one line
// under the top bar (components/StandInLine.tsx). The line must not depend on
// how or when the page asked, so three things are watched: fetch,
// XMLHttpRequest, and the requests that left before this was installed.
// Installed by both page entries, like the deploy wait beside it: the
// platform's (main.tsx) and the shared bar every app page loads (bar/main.tsx),
// so an app shows the line with no code of its own.
import { useMemo, useSyncExternalStore } from 'react'
import { STAND_IN_HEADER, STAND_IN_TIMING, readStandInHeader, type StandInServed } from 'shared'

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

type Remember = typeof recordStandIns

/** What one answer said, remembered under the page the document is on when it
 *  arrives, if it is a same-site `/api/...` answer. A request is named by its
 *  method, its API address and its body when that is text. An error answer
 *  carried no rows, so it says nothing about the rows already on screen and
 *  clears nothing. */
function noteAnswer(record: Remember, asked: { method: string; address: string; body: unknown }, ok: boolean, header: string | null): void {
  const url = new URL(asked.address, window.location.href)
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return
  const served = readStandInHeader(header)
  if (!ok && !served.length) return
  const body = typeof asked.body === 'string' ? asked.body : ''
  record(window.location.pathname, `${asked.method.toUpperCase()} ${url.pathname}${url.search} ${body}`, served)
}

/** `base`, except that every same-site `/api/...` answer has its stand-in
 *  header read and remembered. The answer is passed on untouched: a header is
 *  read without consuming the body. */
export function markStandIns(base: Fetch, record: Remember = recordStandIns): Fetch {
  return async function fetchMarkingStandIns(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const answer = await base(input, init)
    noteAnswer(record, {
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      address: input instanceof Request ? input.url : String(input),
      body: init?.body,
    }, answer.ok, answer.headers.get(STAND_IN_HEADER))
    return answer
  }
}

/** The same for a page that asks through XMLHttpRequest (axios does): `open`
 *  and `send` are wrapped on the prototype, once, to know what each request
 *  asked, and its stand-in header is read when it finishes. The request itself
 *  is untouched: both calls go on to the browser's own with what they were given. */
export function markStandInsOverXhr(Xhr: typeof XMLHttpRequest, record: Remember = recordStandIns): void {
  const asked = new WeakMap<XMLHttpRequest, { method: string; address: string }>()
  const { open, send } = Xhr.prototype
  Xhr.prototype.open = function (this: XMLHttpRequest, ...given: Parameters<XMLHttpRequest['open']>) {
    asked.set(this, { method: given[0], address: String(given[1]) })
    return open.apply(this, given)
  } as XMLHttpRequest['open']
  Xhr.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    // Opened before this was installed: what it asked is not known.
    const request = asked.get(this)
    if (request)
      this.addEventListener('loadend', () => {
        noteAnswer(record, { ...request, body }, this.status >= 200 && this.status < 300, this.getResponseHeader(STAND_IN_HEADER))
      }, { once: true })
    return send.call(this, body)
  }
}

/** What the page can be asked about its own requests, and where it is. */
type TimedPage = Pick<Window & typeof globalThis, 'PerformanceObserver' | 'PerformanceResourceTiming' | 'performance' | 'location'>

/** Requests that left before the wrappers above existed: a plain script in an
 *  app's page runs before the bar's module does, so its reads go through
 *  neither. The server repeats the stand-in list as a `Server-Timing` metric,
 *  which the browser keeps with every request it made (Resource Timing),
 *  whoever made it. Each same-site `/api/...` request that started before now
 *  and named stand-ins is remembered under a name of its own, which no later
 *  answer clears: nothing here knows what it asked, so nothing can say it was
 *  asked again. A request that starts later is the wrappers' to read. Where
 *  the browser keeps no Server-Timing (or there is no browser), this does nothing. */
export function markEarlierStandIns(page: TimedPage, record: Remember = recordStandIns): void {
  const { PerformanceObserver: Observer, PerformanceResourceTiming: Timing } = page
  if (typeof Observer !== 'function' || typeof Timing !== 'function' || !('serverTiming' in Timing.prototype)) return
  const installed = page.performance.now()
  new Observer((list) => {
    for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
      if (entry.startTime >= installed) continue
      const url = new URL(entry.name)
      if (url.origin !== page.location.origin || !url.pathname.startsWith('/api/')) continue
      const served = readStandInHeader(entry.serverTiming.find((metric) => metric.name === STAND_IN_TIMING)?.description)
      if (served.length) record(page.location.pathname, `early ${url.pathname}${url.search} ${entry.startTime}`, served)
    }
    // `buffered` hands over the requests already finished; one still on its way arrives when it ends.
  }).observe({ type: 'resource', buffered: true })
}

const INSTALLED = Symbol.for('featherbase.stand-in-mark')

/** Watch the page's requests (once), so every answer's stand-ins are
 *  remembered however and whenever the page asked: through fetch, through
 *  XMLHttpRequest, or before this ran. All of it is done before this returns. */
export function installStandInMark(win: Window & typeof globalThis): void {
  const marked = win as unknown as Record<symbol, boolean>
  if (marked[INSTALLED]) return
  marked[INSTALLED] = true
  win.fetch = markStandIns(win.fetch.bind(win))
  if (typeof win.XMLHttpRequest === 'function') markStandInsOverXhr(win.XMLHttpRequest)
  markEarlierStandIns(win)
}
