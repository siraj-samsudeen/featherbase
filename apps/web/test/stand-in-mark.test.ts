// #1409 (design D6): what a page was told about stand-ins. The server names
// the stand-ins a response carried in one header; lib/stand-in-mark.ts wraps
// the page's fetch, reads the header and remembers it per page, for the line
// under the top bar. The line must not depend on how or when the page asked,
// so XMLHttpRequest is watched too, and a request that left before the mark
// was installed is read from what the browser kept of it. These tests drive
// each with a scripted fetch, request or browser; the line itself, against the
// real server, is stand-in-line.test.tsx, and a real browser's part is
// e2e-served/stand-in-datasets.spec.ts.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { STAND_IN_HEADER, STAND_IN_TIMING, standInHeaderValue, type StandInServed } from 'shared'
import { forgetStandIns, installStandInMark, markEarlierStandIns, markStandIns, markStandInsOverXhr, recordStandIns, useStandIns } from '../src/lib/stand-in-mark'

const TARGETS: StandInServed = { app: 'storesales', dataset: 'targets', loaded_at: '2026-11-27T06:28:27.434Z', note: 'From the planning workbook', expected_by: '2026-12-15' }
const SALES: StandInServed = { app: 'storesales', dataset: 'sales', loaded_at: '2026-11-26T04:00:00.000Z', note: null, expected_by: null }

const answer = (standIns: StandInServed[] = [], status = 200) => new Response('{"result":1}', {
  status, headers: standIns.length ? { [STAND_IN_HEADER]: standInHeaderValue(standIns) } : {},
})
const here = (path: string) => new URL(path, window.location.href).href
/** A wrapped fetch whose answers come from `next`, and what it remembered. */
function marked(next: () => Response) {
  const seen: [string, string, readonly StandInServed[]][] = []
  const fetch = markStandIns(vi.fn(async () => next()) as unknown as typeof globalThis.fetch, (...told) => seen.push(told))
  return { fetch, seen }
}

afterEach(() => {
  forgetStandIns()
  window.history.replaceState(null, '', '/')
})

describe('reading the header off an answer', () => {
  test('an answer that carried stand-in rows is remembered under the page it arrived on, and passed on unread', async () => {
    window.history.replaceState(null, '', '/storesales/')
    const { fetch, seen } = marked(() => answer([TARGETS]))
    const res = await fetch('/api/app_reads/storesales/overview?x=1', { method: 'post', body: '{"payload":{}}' })
    expect(await res.json()).toEqual({ result: 1 })
    expect(seen).toEqual([['/storesales/', 'POST /api/app_reads/storesales/overview?x=1 {"payload":{}}', [TARGETS]]])
  })

  test('an answer with no header says the request carried none', async () => {
    const { fetch, seen } = marked(() => answer())
    await fetch(here('/api/datasets'))
    expect(seen).toEqual([['/', 'GET /api/datasets ', []]])
  })

  test('a request given as a Request is named by its own method and address', async () => {
    const { fetch, seen } = marked(() => answer([SALES]))
    await fetch(new Request(here('/api/app_reads/storesales/sales'), { method: 'POST', body: '{}' }))
    expect(seen).toEqual([['/', 'POST /api/app_reads/storesales/sales ', [SALES]]])
  })

  test('a body that is not text is left out of the request\'s name', async () => {
    const { fetch, seen } = marked(() => answer())
    await fetch('/api/upload', { method: 'POST', body: new FormData() })
    expect(seen).toEqual([['/', 'POST /api/upload ', []]])
  })

  test('an error answer carried no rows, so it clears nothing', async () => {
    const { fetch, seen } = marked(() => answer([], 503))
    expect((await fetch('/api/app_reads/storesales/overview')).status).toBe(503)
    expect(seen).toEqual([])
  })

  test('another site\'s answer, and an address outside /api, are not read', async () => {
    const { fetch, seen } = marked(() => answer([TARGETS]))
    await fetch('https://elsewhere.example/api/app_reads/storesales/overview')
    await fetch('/storesales/assets/main.js')
    expect(seen).toEqual([])
  })

  test('a header that cannot be read names no stand-in', async () => {
    const { fetch, seen } = marked(() => new Response('{}', { headers: { [STAND_IN_HEADER]: '%7Bnot-a-list' } }))
    await fetch('/api/datasets')
    expect(seen).toEqual([['/', 'GET /api/datasets ', []]])
  })
})

/** A request as a page's XMLHttpRequest makes it, answered when the test says. */
class ScriptedRequest extends EventTarget {
  status = 0
  opened: unknown[] = []
  sent: unknown
  private headers: Record<string, string> = {}
  open(...given: unknown[]) { this.opened = given }
  send(body?: unknown) { this.sent = body }
  getResponseHeader(name: string) { return this.headers[name] ?? null }
  answer(status: number, standIns: StandInServed[] = []) {
    this.status = status
    if (standIns.length) this.headers[STAND_IN_HEADER] = standInHeaderValue(standIns)
    this.dispatchEvent(new Event('loadend'))
  }
}
/** A page's own XMLHttpRequest, watched, and what was remembered from it. */
function watchedRequests() {
  class PageRequest extends ScriptedRequest {}
  const seen: [string, string, readonly StandInServed[]][] = []
  const before = new PageRequest()
  before.open('GET', '/api/datasets')
  markStandInsOverXhr(PageRequest as unknown as typeof XMLHttpRequest, (...told) => seen.push(told))
  return { PageRequest, seen, before }
}

describe('a page that asks through XMLHttpRequest', () => {
  test('an answer that carried stand-in rows is remembered as a fetch\'s is, and the request goes out as it was made', () => {
    window.history.replaceState(null, '', '/storesales/')
    const { PageRequest, seen } = watchedRequests()
    const request = new PageRequest()
    request.open('post', '/api/app_reads/storesales/overview?x=1', true)
    request.send('{"payload":{}}')
    expect([request.opened, request.sent]).toEqual([['post', '/api/app_reads/storesales/overview?x=1', true], '{"payload":{}}'])
    expect(seen).toEqual([])
    request.answer(200, [TARGETS])
    expect(seen).toEqual([['/storesales/', 'POST /api/app_reads/storesales/overview?x=1 {"payload":{}}', [TARGETS]]])
  })

  test('the same request answered again without stand-in rows says it carried none', () => {
    const { PageRequest, seen } = watchedRequests()
    for (const standIns of [[SALES], []]) {
      const request = new PageRequest()
      request.open('GET', new URL(here('/api/app_reads/storesales/sales')))
      request.send()
      request.answer(200, standIns)
    }
    expect(seen).toEqual([['/', 'GET /api/app_reads/storesales/sales ', [SALES]], ['/', 'GET /api/app_reads/storesales/sales ', []]])
  })

  test('a body that is not text is left out of the request\'s name', () => {
    const { PageRequest, seen } = watchedRequests()
    const request = new PageRequest()
    request.open('POST', '/api/upload')
    request.send(new FormData())
    request.answer(201)
    expect(seen).toEqual([['/', 'POST /api/upload ', []]])
  })

  test('an error answer, and a request that never got one, clear nothing', () => {
    const { PageRequest, seen } = watchedRequests()
    for (const status of [503, 0]) {
      const request = new PageRequest()
      request.open('GET', '/api/app_reads/storesales/overview')
      request.send()
      request.answer(status)
    }
    expect(seen).toEqual([])
  })

  test('another site\'s answer, and an address outside /api, are not read', () => {
    const { PageRequest, seen } = watchedRequests()
    for (const address of ['https://elsewhere.example/api/app_reads/storesales/overview', '/storesales/assets/data.json']) {
      const request = new PageRequest()
      request.open('GET', address)
      request.send()
      request.answer(200, [TARGETS])
    }
    expect(seen).toEqual([])
  })

  test('a request opened before the page was watched is sent as it is, and not read', () => {
    const { seen, before } = watchedRequests()
    before.send('late')
    before.answer(200, [TARGETS])
    expect(before.sent).toBe('late')
    expect(seen).toEqual([])
  })
})

type TimedPage = Parameters<typeof markEarlierStandIns>[0]
type Told = (list: { getEntries: () => unknown[] }) => void
/** A browser that keeps Server-Timing with each request it made, at time `now`,
 *  and the callback its observer was given. */
function timedPage(now: number, { keepsServerTiming = true } = {}) {
  const watching: { observed?: unknown; told?: Told } = {}
  class Observer {
    constructor(told: Told) { watching.told = told }
    observe(options: unknown) { watching.observed = options }
  }
  class Timing {}
  if (keepsServerTiming) Object.defineProperty(Timing.prototype, 'serverTiming', { get: () => [] })
  const page = { PerformanceObserver: Observer, PerformanceResourceTiming: Timing, performance: { now: () => now }, location: window.location }
  return { page: page as unknown as TimedPage, watching }
}
/** One request as the browser kept it. */
const kept = (address: string, startTime: number, standIns?: StandInServed[] | string) => ({
  name: here(address),
  startTime,
  serverTiming: [
    { name: 'db', description: '' },
    ...(standIns === undefined ? [] : [{ name: STAND_IN_TIMING, description: typeof standIns === 'string' ? standIns : standInHeaderValue(standIns) }]),
  ],
})

describe('a request that left before the mark was installed', () => {
  test('is read from what the browser kept of it, and remembered under a name of its own', () => {
    window.history.replaceState(null, '', '/storesales/')
    const seen: [string, string, readonly StandInServed[]][] = []
    const { page, watching } = timedPage(120)
    markEarlierStandIns(page, (...told) => seen.push(told))
    // The requests already finished are handed over, and one still on its way arrives when it ends.
    expect(watching.observed).toEqual({ type: 'resource', buffered: true })
    watching.told!({ getEntries: () => [kept('/api/app_reads/storesales/overview?x=1', 41.5, [TARGETS])] })
    watching.told!({ getEntries: () => [kept('/api/app_reads/storesales/sales', 60, [SALES])] })
    expect(seen).toEqual([
      ['/storesales/', 'early /api/app_reads/storesales/overview?x=1 41.5', [TARGETS]],
      ['/storesales/', 'early /api/app_reads/storesales/sales 60', [SALES]],
    ])
  })

  test('only a same-site /api request that started earlier and named stand-ins is remembered', () => {
    const seen: unknown[] = []
    const { page, watching } = timedPage(120)
    markEarlierStandIns(page, (...told) => seen.push(told))
    watching.told!({ getEntries: () => [
      // Started once the mark was installed: the fetch and XMLHttpRequest wrappers read those.
      kept('/api/app_reads/storesales/overview', 120, [TARGETS]),
      kept('/api/app_reads/storesales/overview', 300, [TARGETS]),
      { ...kept('/api/app_reads/storesales/overview', 10, [TARGETS]), name: 'https://elsewhere.example/api/app_reads/storesales/overview' },
      kept('/storesales/assets/main.js', 10, [TARGETS]),
      kept('/api/app_reads/storesales/sales', 10),
      kept('/api/app_reads/storesales/sales', 11, []),
      kept('/api/app_reads/storesales/sales', 12, '%7Bnot-a-list'),
    ] })
    expect(seen).toEqual([])
  })

  test('what it said is not cleared by a later answer, which cannot know it is the same request', () => {
    const page = renderHook(() => useStandIns('/'))
    const { page: browser, watching } = timedPage(120)
    markEarlierStandIns(browser)
    act(() => watching.told!({ getEntries: () => [kept('/api/app_reads/storesales/overview', 10, [TARGETS])] }))
    act(() => recordStandIns('/', 'POST /api/app_reads/storesales/overview {"payload":{}}', []))
    expect(page.result.current).toEqual([TARGETS])
  })

  test('a browser that keeps no Server-Timing, and a page with no such browser, are left alone', () => {
    const old = timedPage(120, { keepsServerTiming: false })
    markEarlierStandIns(old.page)
    expect(old.watching.told).toBeUndefined()
    const bare = { performance: { now: () => 0 }, location: window.location }
    expect(() => markEarlierStandIns(bare as unknown as TimedPage)).not.toThrow()
    const untimed = timedPage(120)
    markEarlierStandIns({ ...untimed.page, PerformanceResourceTiming: undefined } as unknown as TimedPage)
    expect(untimed.watching.told).toBeUndefined()
  })
})

describe('what a page remembers', () => {
  const shown = (pathname: string) => renderHook(({ at }) => useStandIns(at), { initialProps: { at: pathname } })

  test('each dataset is shown once, in name order, whichever requests carried it', () => {
    const page = shown('/storesales/')
    expect(page.result.current).toEqual([])
    act(() => {
      recordStandIns('/storesales/', 'POST overview', [TARGETS, SALES])
      recordStandIns('/storesales/', 'POST ask', [TARGETS])
    })
    expect(page.result.current).toEqual([SALES, TARGETS])
  })

  test('a dataset loaded again is shown by its latest load', () => {
    const again = { ...TARGETS, loaded_at: '2026-11-28T03:00:00.000Z', note: 'Second draft' }
    const page = shown('/storesales/')
    act(() => {
      recordStandIns('/storesales/', 'POST ask', [again])
      recordStandIns('/storesales/', 'POST overview', [TARGETS])
    })
    expect(page.result.current).toEqual([again])
  })

  test('a request answered again without stand-in rows clears only what it said', () => {
    const page = shown('/storesales/')
    act(() => {
      recordStandIns('/storesales/', 'POST overview', [TARGETS])
      recordStandIns('/storesales/', 'POST sales', [SALES])
    })
    act(() => recordStandIns('/storesales/', 'POST overview', []))
    expect(page.result.current).toEqual([SALES])
    act(() => recordStandIns('/storesales/', 'POST sales', []))
    expect(page.result.current).toEqual([])
  })

  test('each page keeps its own: another page shows none, and going back shows what was remembered', () => {
    const page = shown('/storesales/')
    act(() => recordStandIns('/storesales/', 'POST overview', [TARGETS]))
    page.rerender({ at: '/storesales/help' })
    expect(page.result.current).toEqual([])
    page.rerender({ at: '/storesales/' })
    expect(page.result.current).toEqual([TARGETS])
  })

  // Kept by pathname on purpose, not by pathname and query. A view often
  // changes its query (a month, a filter) and keeps showing rows it already
  // had, without reading again; kept by the query too, that view would lose
  // its line while still showing sample data. This way errs toward marking.
  test('two views of one page that differ only in the query string share what the page remembers', () => {
    window.history.replaceState(null, '', '/storesales/?month=2026-12')
    const page = shown(window.location.pathname)
    act(() => recordStandIns(window.location.pathname, 'POST overview', [TARGETS]))
    expect(page.result.current).toEqual([TARGETS])
    act(() => window.history.pushState(null, '', '/storesales/?month=2027-01'))
    page.rerender({ at: window.location.pathname })
    expect(window.location.search).toBe('?month=2027-01')
    expect(page.result.current).toEqual([TARGETS])
  })

  test('an answer that says what is already remembered changes nothing', () => {
    const page = shown('/storesales/')
    act(() => recordStandIns('/storesales/', 'POST overview', [TARGETS]))
    const before = page.result.current
    act(() => {
      recordStandIns('/storesales/', 'POST overview', [{ ...TARGETS }])
      recordStandIns('/storesales/', 'GET nothing', [])
    })
    expect(page.result.current).toBe(before)
  })
})

describe('installing the mark on a page', () => {
  /** A page with fetch, XMLHttpRequest and a browser that keeps Server-Timing. */
  function page() {
    class PageRequest extends ScriptedRequest {}
    const base = vi.fn(async () => answer([TARGETS]))
    const { page: timed, watching } = timedPage(120)
    const win = { ...timed, fetch: base, XMLHttpRequest: PageRequest } as unknown as Window & typeof globalThis
    return { win, base, PageRequest, watching }
  }

  test('fetch, XMLHttpRequest and the earlier requests are all watched before it returns', async () => {
    window.history.replaceState(null, '', '/storesales/')
    const { win, PageRequest, watching } = page()
    const shown = renderHook(() => useStandIns('/storesales/'))
    installStandInMark(win)

    await act(async () => { await win.fetch('/api/app_reads/storesales/overview') })
    expect(shown.result.current).toEqual([TARGETS])
    act(() => forgetStandIns())

    const request = new PageRequest()
    request.open('GET', '/api/app_reads/storesales/sales')
    request.send()
    act(() => request.answer(200, [SALES]))
    expect(shown.result.current).toEqual([SALES])
    act(() => forgetStandIns())

    act(() => watching.told!({ getEntries: () => [kept('/api/app_reads/storesales/overview', 10, [TARGETS])] }))
    expect(shown.result.current).toEqual([TARGETS])
  })

  test('it is installed once, however many entries load', async () => {
    const { win, base, PageRequest } = page()
    installStandInMark(win)
    const [fetch, open] = [win.fetch, PageRequest.prototype.open]
    installStandInMark(win)
    expect(win.fetch).toBe(fetch)
    expect(PageRequest.prototype.open).toBe(open)
    await act(async () => { await win.fetch('/api/app_reads/storesales/overview') })
    expect(base).toHaveBeenCalledTimes(1)
  })

  test('a page with fetch alone is watched through it, and nothing else is asked of it', async () => {
    const base = vi.fn(async () => answer([TARGETS]))
    const win = { fetch: base, performance: { now: () => 0 }, location: window.location } as unknown as Window & typeof globalThis
    installStandInMark(win)
    const shown = renderHook(() => useStandIns('/'))
    await act(async () => { await win.fetch('/api/app_reads/storesales/overview') })
    expect(shown.result.current).toEqual([TARGETS])
  })
})
