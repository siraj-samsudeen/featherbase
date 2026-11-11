// The report page rendered by React, in a DOM (jsdom from this repository's apps/web: no test
// dependency of the app's own), with the platform's reads played
// by a stand-in `fetch` (the network boundary). Codex round 8: choosing a store invalidates the
// previous store's answers AT ONCE, so an answer that lands between the choice and React's
// effect never draws the previous store's figures under the new one. Made-up stores and figures.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Shop Floor's icons come with the workspace's copy of React; the real page bundles one. An icon
// says nothing these tests read, so here each draws nothing (#1205's banner is a Shop Floor Notice).
vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

type Deferred = { resolve: (body: unknown) => void }
const calls: { name: string; store?: string; payload: Record<string, unknown>; answer: Deferred }[] = []
let teardown: () => void = () => {}
const SALES = { key: 'sales', name: 'Sales versus target', takes_store: true, takes_month: true }
const WHOLE = { key: 'whole', name: 'Store target month to date', takes_store: false, takes_month: false }
let reportsAnswer: unknown = [SALES, WHOLE]
let problemsAnswer: unknown = { problems: [] }
let setupAnswer: unknown = { state: 'ok', reviewer: 'Mani', current: null }
let holdsAnswer = false

beforeAll(() => {
  // This repository's root (client-apps/jeyarama/dash/src → four levels up), with `pnpm install` run.
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Record<string, unknown> & { close(): void } } }
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/dash/?store=9901' })
  const added: string[] = []
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue
    Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] })
    added.push(key)
  }
  for (const key of ['window', 'document', 'navigator', 'location', 'history'])
    Object.defineProperty(globalThis, key, { configurable: true, get: () => (key === 'window' ? dom.window : dom.window[key]) })
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).fetch = (url: string, init: RequestInit) => {
    const name = decodeURIComponent(String(url).split('/').at(-1)!)
    const payload = JSON.parse(String(init.body)).payload ?? {}
    const store = payload.store
    return new Promise(resolveCall => {
      const answer: Deferred = { resolve: body => resolveCall(new Response(JSON.stringify({ result: body }), { status: 200 })) }
      calls.push({ name, store, payload, answer })
      if (name === 'stores') answer.resolve([{ value: '9901', label: 'Lakeside · 9901' }, { value: '9902', label: 'Hillview · 9902' }])
      if (name === 'reports') answer.resolve(reportsAnswer)
      if (name === 'reach_problem') answer.resolve(problemsAnswer)
      if (name === 'department_setup') answer.resolve(setupAnswer)
      if (name === 'holds_department_job') answer.resolve(holdsAnswer)
    })
  }
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const report = (store: string, name: string) => {
  const totals = { target: 1000, actual: 800, gap: -200, achievement: 80, missing: 0, no_target_no_sale: 0, n: 1, targets_recorded: 1, sales_recorded: 1 }
  return { state: 'ready', store, store_name: 'Made-up', short_code: null, period_start: '2026-10-01', period_end: '2026-10-15',
    refreshed_at: '2026-10-15T00:19:00.000Z', data_through: '2026-10-14', targets_available: true,
    rows: [{ code: '010101001', subcategory: name, section: 'Sarees', target: 1000, actual: 800, gap: -200, achievement: 80,
      missingActual: false, noTargetNoSale: false, targetRecorded: true, salesRecorded: true }],
    sections: [{ section: 'Sarees', ...totals }], total: totals }
}

describe('choosing another store on the rendered page', () => {
  it("never draws the previous store's figures under the new store, even for an answer that lands before the new store opens", async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    const container = document.getElementById('root')!
    const drawn: string[] = []
    const observer = new MutationObserver(records => {
      for (const r of records) for (const node of r.addedNodes) drawn.push(node.textContent ?? '')
    })
    observer.observe(container, { childList: true, subtree: true, characterData: true })
    await act(async () => { createRoot(container).render(<Dash />) })
    await act(async () => { await settle() })
    const old = calls.filter(c => c.store === '9901')
    expect(old.map(c => c.name).sort()).toEqual(['embed_session', 'report'])
    // The reader picks Hillview; 9901's answers land before React's effect opens 9902.
    await act(async () => {
      history.pushState(null, '', '?store=9902')
      const DomEvent = (window as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent
      window.dispatchEvent(new DomEvent('featherbase:bar-change', { detail: { key: 'store', value: '9902' } }))
      for (const c of old) c.answer.resolve(c.name === 'report' ? report('9901', 'Old store silk') : { not_set_up: true })
      await settle()
    })
    await act(async () => { await settle() })
    for (const r of observer.takeRecords()) for (const node of r.addedNodes) drawn.push(node.textContent ?? '')
    expect([drawn.some(text => text.includes('Old store silk')), container.textContent?.includes('Old store silk')]).toEqual([false, false])
  })

  // Codex round 9: the bar, or Back/Forward, repeating the store on show must never leave the
  // page waiting with nothing in flight.
  async function openOn9901({ answer = true, embed = { not_set_up: true } as Record<string, unknown> } = {}) {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    history.replaceState(null, '', '?store=9901')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<Dash />) })
    await act(async () => { await settle() })
    const answerAll = async () => {
      for (const c of calls.filter(c => c.store === '9901'))
        c.answer.resolve(c.name === 'report' ? report('9901', 'Lakeside silk') : embed)
      await act(async () => { await settle() })
    }
    if (answer) await answerAll()
    return { act, container, answerAll, unmount: () => act(async () => root.unmount()) }
  }
  const DomEvent = () => (window as unknown as { CustomEvent: typeof CustomEvent; PopStateEvent: typeof PopStateEvent })

  it('stays on its figures when the bar repeats the store on show', async () => {
    const { act, container, unmount } = await openOn9901()
    await act(async () => {
      window.dispatchEvent(new (DomEvent().CustomEvent)('featherbase:bar-change', { detail: { key: 'store', value: '9901' } }))
      await settle()
    })
    expect(container.querySelector('[data-testid=dash]')?.getAttribute('data-view')).toBe('quick')
    await unmount()
  })

  it('stays on its figures when history moves between two addresses of the same store', async () => {
    const { act, container, unmount } = await openOn9901()
    await act(async () => {
      history.pushState(null, '', '?store=9901&from=back')
      window.dispatchEvent(new (DomEvent().PopStateEvent)('popstate'))
      await settle()
    })
    expect(container.querySelector('[data-testid=dash]')?.getAttribute('data-view')).toBe('quick')
    await unmount()
  })

  it('still reaches its figures when the bar repeats the store while it is loading', async () => {
    const { act, container, answerAll, unmount } = await openOn9901({ answer: false })
    await act(async () => {
      window.dispatchEvent(new (DomEvent().CustomEvent)('featherbase:bar-change', { detail: { key: 'store', value: '9901' } }))
      await settle()
    })
    await answerAll()
    expect(container.querySelector('[data-testid=dash]')?.getAttribute('data-view')).toBe('quick')
    await unmount()
  })

  it('still reaches its figures when history repeats the store while it is loading', async () => {
    const { act, container, answerAll, unmount } = await openOn9901({ answer: false })
    await act(async () => {
      history.pushState(null, '', '?store=9901&from=back')
      window.dispatchEvent(new (DomEvent().PopStateEvent)('popstate'))
      await settle()
    })
    await answerAll()
    expect(container.querySelector('[data-testid=dash]')?.getAttribute('data-view')).toBe('quick')
    await unmount()
  })

  // The Dive's ready message is sent to the page's own origin, which only the page knows (#4453).
  it("sends the page's own origin with the Dive's session request", async () => {
    const { unmount } = await openOn9901()
    expect(calls.find(c => c.name === 'embed_session')?.payload.app_origin).toBe('http://localhost')
    await unmount()
  })

  // #950 checklist 7: the top of the page goes to the figures; the cached table says what it is in one line.
  it('says why the cached table shows and how fresh it is in one line, under no title of its own', async () => {
    const { container, unmount } = await openOn9901({ embed: { unreachable: true } })
    const quick = container.querySelector('[data-testid=quick-view]')!
    expect(quick.querySelector('h1, h2, h3')).toBeNull()
    const label = quick.querySelector('[data-testid=quick-label]')!
    expect(label.parentElement).toBe(quick.querySelector('[data-testid=data-line]')!.parentElement)
    expect(label.parentElement?.tagName).toBe('P')
    await unmount()
  })

  // #750: the bar's month picker.
  it('opens last month when the bar chooses it, and never draws this month under it', async () => {
    const { act, container, unmount } = await openOn9901()
    calls.length = 0
    await act(async () => {
      history.pushState(null, '', '?store=9901&month=last')
      window.dispatchEvent(new (DomEvent().CustomEvent)('featherbase:bar-change', { detail: { key: 'month', value: 'last' } }))
      await settle()
    })
    // (The first test's page is still mounted and hears the bar too.)
    expect([[...new Set(calls.map(c => `${c.name} ${c.payload.month}`))].sort(), container.textContent?.includes('Lakeside silk')])
      .toEqual([['embed_session last', 'report last'], false])
    await unmount()
  })

  it('opens the month in the address', async () => {
    history.replaceState(null, '', '?store=9901&month=last')
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<Dash />) })
    await act(async () => { await settle() })
    expect(calls.filter(c => c.name === 'report' || c.name === 'embed_session').map(c => c.payload.month)).toEqual(['last', 'last'])
    await act(async () => root.unmount())
  })
})

// #4486: the header says why the reader sees the store on show, and follows the bar's store picker.
describe("the page's header", () => {
  const withHeading = (store: string, heading: unknown) => ({ ...report(store, `Silk ${store}`), heading })
  const text = (container: Element, id: string) => container.querySelector(`[data-testid=${id}]`)?.textContent ?? null

  it('says why the reader sees the store chosen, under the period and above the measure, and changes with the store', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    history.replaceState(null, '', '?store=9901')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<Dash />) })
    await act(async () => { await settle() })
    const answer = async (store: string, heading: unknown) => {
      for (const c of calls.filter(c => c.store === store))
        c.answer.resolve(c.name === 'report' ? withHeading(store, heading) : { not_set_up: true })
      await act(async () => { await settle() })
    }
    await answer('9901', { name: 'LKS', sections: ['Alpha'], reasons: [{ basis: 'team_leader', sections: ['Alpha'] }] })
    const lines = [...container.querySelectorAll('[data-testid=report-heading] > *')].map(e => e.getAttribute('data-testid'))
    expect(lines).toEqual(['heading-title', 'period-line', 'why-line', 'measure-line'])
    expect([text(container, 'heading-title'), text(container, 'period-line'), text(container, 'why-line'), text(container, 'measure-line')]).toEqual([
      'LKS · Alpha', '01-Oct-2026 to 15-Oct-2026', 'You see Alpha at LKS because you are their Team Leader.', 'Sales before tax, net of returns'])
    expect(container.querySelector('[data-testid=why-line]')?.className).toBe('fd-muted')
    // #4531: no subcategory or plant code anywhere on the page, the quick view's rows included.
    expect(container.textContent).toContain('Silk 9901')
    expect(container.textContent?.replace('Silk 9901', '')).not.toMatch(/\d{9}|\b9901\b/)

    await act(async () => {
      history.pushState(null, '', '?store=9902')
      window.dispatchEvent(new (window as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent('featherbase:bar-change', { detail: { key: 'store', value: '9902' } }))
      await settle()
    })
    await answer('9902', { name: 'HLV', sections: [], reasons: [{ basis: 'store_manager', sections: [] }] })
    expect(text(container, 'why-line')).toBe('You see HLV because you are its Store Manager.')
    await act(async () => root.unmount())
  })

  // sales-target-report, "Many Sections are counted, not listed": the full list is a tap or key press away.
  const openWithSections = async (sections: string[]) => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    history.replaceState(null, '', '?store=9901')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<Dash />) })
    await act(async () => { await settle() })
    for (const c of calls.filter(c => c.store === '9901'))
      c.answer.resolve(c.name === 'report' ? withHeading('9901', { name: 'LKS', sections, reasons: [] }) : { not_set_up: true })
    await act(async () => { await settle() })
    return { act, container, unmount: () => act(async () => root.unmount()) }
  }

  it('lists every section when the reader presses the count, and hides them again', async () => {
    const { act, container, unmount } = await openWithSections(['Alpha', 'Beta', 'Gamma', 'Delta'])
    expect(text(container, 'heading-title')).toBe('LKS · 4 sections')
    expect(container.querySelector('[data-testid=sections-list]')).toBeNull()
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid=heading-title] button')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { toggle.click() })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(text(container, 'sections-list')).toBe('Alpha · Beta · Gamma · Delta')
    await act(async () => { toggle.click() })
    expect(container.querySelector('[data-testid=sections-list]')).toBeNull()
    await unmount()
  })

  it('offers nothing to expand when the title already names the sections', async () => {
    const { container, unmount } = await openWithSections(['Alpha', 'Beta', 'Gamma'])
    expect(text(container, 'heading-title')).toBe('LKS · Alpha · Beta · Gamma')
    expect(container.querySelector('[data-testid=heading-title] button')).toBeNull()
    await unmount()
  })

  it('draws the header above the Dive too', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    history.replaceState(null, '', '?store=9901')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<Dash />) })
    await act(async () => { await settle() })
    for (const c of calls.filter(c => c.store === '9901'))
      c.answer.resolve(c.name === 'report' ? withHeading('9901', { name: 'LKS', sections: [], reasons: [{ basis: 'store_manager', sections: [] }] })
        : { frame: 'https://embed-motherduck.com/sandbox/#session=made-up' })
    await act(async () => { await settle() })
    expect(container.querySelector('[data-testid=dash]')?.getAttribute('data-view')).toBe('dive')
    expect(text(container, 'why-line')).toBe('You see LKS because you are its Store Manager.')
    await act(async () => root.unmount())
  })

  it('leaves the sentence out, not an empty line, when no reason is known', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    history.replaceState(null, '', '?store=9901')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<Dash />) })
    await act(async () => { await settle() })
    for (const c of calls.filter(c => c.store === '9901'))
      c.answer.resolve(c.name === 'report' ? withHeading('9901', { name: 'LKS', sections: ['Alpha'], reasons: [] }) : { not_set_up: true })
    await act(async () => { await settle() })
    const lines = [...container.querySelectorAll('[data-testid=report-heading] > *')].map(e => e.getAttribute('data-testid'))
    expect(lines).toEqual(['heading-title', 'period-line', 'measure-line'])
    expect(container.textContent).not.toContain('because')
    await act(async () => root.unmount())
  })
})

// #967's UI checklist: any report, whatever it takes.
describe('a report on the rendered page', () => {
  async function open(address: string) {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    history.replaceState(null, '', address)
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<Dash />) })
    await act(async () => { await settle() })
    const answer = async (name: string, body: unknown) => {
      for (const c of calls.filter(c => c.name === name)) c.answer.resolve(body)
      await act(async () => { await settle() })
    }
    const view = () => container.querySelector('[data-testid=dash]')?.getAttribute('data-view')
    return { container, answer, view, unmount: () => act(async () => root.unmount()) }
  }
  const asked = (name: string) => calls.filter(c => c.name === name).map(c => c.payload)
  const plain = { state: 'ready', no_quick_view: true, heading: { name: null, sections: [], reasons: [] } }
  const frame = { frame: 'https://embed-motherduck.com/sandbox/#session=made-up' }

  // #1159: the Dive has its own Store and Month pickers; the page passes it the address's choice.
  describe('a report whose Dive has its own pickers', () => {
    const PICKERS = { key: 'sales', name: 'Sales versus target', takes_store: false, takes_month: false, no_filter: false, pickers_in_dive: true }
    const headed = { ...report('9901', 'Silk'), pickers_in_dive: true, heading: { name: 'Lakeside', sections: [], reasons: [{ basis: 'store_manager', sections: [] }] } }
    afterEach(() => { reportsAnswer = [SALES, WHOLE] })

    it("opens at once with the address's store and month, asking no store list, and draws no heading over the Dive", async () => {
      reportsAnswer = [PICKERS]
      const { answer, view, container, unmount } = await open('?store=9901&month=last')
      const opened = [asked('report'), asked('stores')]
      await answer('report', headed)
      await answer('embed_session', frame)
      expect([opened, view(), container.querySelector('[data-testid=report-heading]')])
        .toEqual([[[{ store: '9901', month: 'last' }], []], 'dive', null])
      await unmount()
    })

    it('names the store over the cached view while the Dive is not there', async () => {
      reportsAnswer = [PICKERS]
      const { answer, view, container, unmount } = await open('?store=9901')
      await answer('report', headed)
      await answer('embed_session', { unreachable: true })
      expect([view(), container.querySelector('[data-testid=heading-title]')?.textContent]).toEqual(['quick', 'Lakeside'])
      await unmount()
    })
  })

  it('opens a report taking no store at once, naming the report, with no store and no store check', async () => {
    const { answer, view, container, unmount } = await open('?report=whole')
    expect([asked('report'), asked('stores')]).toEqual([[{ report: 'whole', month: 'this' }], []])
    await answer('report', plain)
    await answer('embed_session', frame)
    expect(view()).toBe('dive')
    expect(container.querySelector('[data-testid=report-frame]')?.getAttribute('title')).toBe('Store target month to date')
    await unmount()
  })

  it("opens the reader's first report when the address names none, leaving the server to choose it", async () => {
    reportsAnswer = [WHOLE, SALES]
    const { unmount } = await open('?')
    reportsAnswer = [SALES, WHOLE]
    expect([asked('report'), asked('stores')]).toEqual([[{ month: 'this' }], []])
    await unmount()
  })

  it('checks the store against the report named', async () => {
    const { unmount } = await open('?report=sales&store=9901')
    expect(asked('stores')).toEqual([{ report: 'sales' }])
    expect(asked('report')).toEqual([{ report: 'sales', store: '9901', month: 'this' }])
    await unmount()
  })

  it('shows no-access for a report that does not exist', async () => {
    const { answer, view, unmount } = await open('?report=nope')
    await answer('report', { state: 'no_access' })
    await answer('embed_session', { refused: 'no_access' })
    expect(view()).toBe('no_access')
    await unmount()
  })

  it("says a whole-stores report isn't available for this job", async () => {
    const { answer, container, unmount } = await open('?report=whole')
    await answer('report', { state: 'whole_stores_only' })
    expect(container.querySelector('[data-testid=empty-whole_stores_only]')?.textContent).toBe("This report covers whole stores, so it isn't available for your job.")
    await unmount()
  })

  // #1143: the cached view stands in at the deadline, and the same frame, kept out of sight, takes
  // over when the Dive says it is ready (MotherDuck's session start can take longer than the deadline).
  it('keeps the Dive behind the cached view past the deadline, and shows that same frame once it is ready', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    const { DIVE_READY_TIMEOUT_MS } = await import('./page')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      history.replaceState(null, '', '?store=9901')
      calls.length = 0
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      await act(async () => { root.render(<Dash />) })
      await act(async () => { await settle() })
      for (const c of calls.filter(c => c.store === '9901'))
        c.answer.resolve(c.name === 'report' ? report('9901', 'Silk')
          : { frame: 'https://embed-motherduck.com/sandbox/#session=made-up', ready_signal: true })
      await act(async () => { await settle() })
      await act(async () => { vi.advanceTimersByTime(DIVE_READY_TIMEOUT_MS); await settle() })
      const view = () => container.querySelector('[data-testid=dash]')?.getAttribute('data-view')
      const frame = container.querySelector('[data-testid=report-frame]') as HTMLIFrameElement | null
      const behind = [view(), frame?.closest('[aria-hidden=true]') !== null, container.textContent?.includes('Silk')]
      await act(async () => {
        // jsdom's MessageEvent: Node has a global one of its own, which a jsdom window rejects as a source.
        const JsdomMessageEvent = (window as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent
        window.dispatchEvent(new JsdomMessageEvent('message', { origin: 'https://embed-motherduck.com', source: frame!.contentWindow, data: { type: 'feather-dash:dive-ready' } }))
        await settle()
      })
      const shown = container.querySelector('[data-testid=report-frame]')
      expect([behind, [view(), shown === frame, shown?.closest('[aria-hidden=true]') ?? null]])
        .toEqual([['quick', true, true], ['dive', true, null]])
      await act(async () => root.unmount())
    } finally {
      vi.useRealTimers()
    }
  })

  // #1143, found on production: past the deadline with the cached copy not built yet, the page says
  // the figures are being prepared; a Dive that is ready later must still take over, in the same frame.
  it('keeps the Dive behind "being prepared" past the deadline, and shows that same frame once it is ready', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    const { DIVE_READY_TIMEOUT_MS } = await import('./page')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      history.replaceState(null, '', '?store=9901')
      calls.length = 0
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      await act(async () => { root.render(<Dash />) })
      await act(async () => { await settle() })
      for (const c of calls.filter(c => c.store === '9901'))
        c.answer.resolve(c.name === 'report' ? { ...report('9901', 'Silk'), state: 'not_built', rows: [] }
          : { frame: 'https://embed-motherduck.com/sandbox/#session=made-up', ready_signal: true })
      await act(async () => { await settle() })
      await act(async () => { vi.advanceTimersByTime(DIVE_READY_TIMEOUT_MS); await settle() })
      const view = () => container.querySelector('[data-testid=dash]')?.getAttribute('data-view')
      const frame = container.querySelector('[data-testid=report-frame]') as HTMLIFrameElement | null
      const behind = [view(), container.querySelector('[data-testid=empty-not_built]') !== null, !!frame && frame.closest('[aria-hidden=true]') !== null]
      await act(async () => {
        const JsdomMessageEvent = (window as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent
        window.dispatchEvent(new JsdomMessageEvent('message', { origin: 'https://embed-motherduck.com', source: frame?.contentWindow ?? null, data: { type: 'dash:dive-ready' } }))
        await settle()
      })
      expect([behind, [view(), container.querySelector('[data-testid=report-frame]') === frame]]).toEqual([['empty', true, true], ['dive', true]])
      await act(async () => root.unmount())
    } finally {
      vi.useRealTimers()
    }
  })

  // #1159: "this month's figures haven't arrived" is about the cached copy of one store and month; a
  // ready Dive, where the reader may choose another, takes over from it in the same frame.
  it('keeps the Dive behind "not arrived yet", and shows that same frame once it is ready', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    const { DIVE_READY_TIMEOUT_MS } = await import('./page')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      history.replaceState(null, '', '?store=9901')
      calls.length = 0
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      await act(async () => { root.render(<Dash />) })
      await act(async () => { await settle() })
      for (const c of calls.filter(c => c.store === '9901'))
        c.answer.resolve(c.name === 'report' ? { ...report('9901', 'Silk'), state: 'no_data_yet', rows: [] }
          : { frame: 'https://embed-motherduck.com/sandbox/#session=made-up', ready_signal: true })
      await act(async () => { await settle() })
      await act(async () => { vi.advanceTimersByTime(DIVE_READY_TIMEOUT_MS); await settle() })
      const view = () => container.querySelector('[data-testid=dash]')?.getAttribute('data-view')
      const frame = container.querySelector('[data-testid=report-frame]') as HTMLIFrameElement | null
      const behind = [view(), container.querySelector('[data-testid=empty-no_data_yet]') !== null, !!frame && frame.closest('[aria-hidden=true]') !== null]
      await act(async () => {
        const JsdomMessageEvent = (window as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent
        window.dispatchEvent(new JsdomMessageEvent('message', { origin: 'https://embed-motherduck.com', source: frame?.contentWindow ?? null, data: { type: 'dash:dive-ready' } }))
        await settle()
      })
      expect([behind, [view(), container.querySelector('[data-testid=report-frame]') === frame]]).toEqual([['empty', true, true], ['dive', true]])
      await act(async () => root.unmount())
    } finally {
      vi.useRealTimers()
    }
  })

  it("says this report couldn't open, with Try again, when it has no quick view and its Dive fails", async () => {
    const { answer, container, unmount } = await open('?report=whole')
    await answer('report', plain)
    await answer('embed_session', { unreachable: true })
    expect(container.querySelector('[data-testid=failed]')?.textContent).toBe("This report couldn't open.Try again")
    await unmount()
  })

  describe('for someone whose job reaches nothing', () => {
    const refusing = async (problems: string[]) => {
      reportsAnswer = []
      problemsAnswer = { problems }
      const page = await open('?')
      await page.answer('report', { state: 'no_access' })
      await page.answer('embed_session', { refused: 'no_access' })
      const { act } = await import('react')
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      return page
    }
    afterEach(() => { reportsAnswer = [SALES, WHOLE]; problemsAnswer = { problems: [] } })

    it('says Staff with no section why, with a link to Your sections', async () => {
      const { container, unmount } = await refusing(['no_section'])
      expect(container.querySelector('[data-testid=reach-problem]')?.textContent).toContain("You aren't set against a section yet")
      expect(container.querySelector('[data-testid=fix-link]')?.getAttribute('href')).toBe('?view=sections')
      await unmount()
    })

    it("asks a Department Manager to set up their department, naming who reviews it (#1195)", async () => {
      const { container, unmount } = await refusing(['departments_not_filled'])
      expect(container.querySelector('[data-testid=reach-title]')?.textContent).toBe('Set up your department to open your report')
      expect(container.querySelector('[data-testid=department-reviewer]')?.textContent).toBe('Mani reviews it. If Mani is away, a Master Data Editor can keep it.')
      expect(container.querySelector('[data-testid=department-link]')?.textContent).toBe('Set up my department')
      expect(container.querySelector('[data-testid=department-link]')?.getAttribute('href')).toBe('?view=department')
      expect(container.querySelector('[data-testid=fix-link]')).toBeNull()
      await unmount()
    })

    it('says a set-up already waits, and for whom (#1195)', async () => {
      setupAnswer = { state: 'ok', reviewer: 'Mani', current: { state: 'waiting', name: 'Ladies Ethnic', asked_on: '2026-11-11', waiting_for: 'Mani' } }
      const { container, unmount } = await refusing(['departments_not_filled'])
      expect(container.querySelector('[data-testid=reach-title]')?.textContent).toBe('Your department is waiting for review')
      expect(container.querySelector('[data-testid=department-waiting]')?.textContent).toBe('You sent “Ladies Ethnic” on 11-Nov-2026. It is waiting for Mani. Your report opens once it is kept.')
      expect(container.querySelector('[data-testid=department-link]')?.textContent).toBe('Open your department')
      setupAnswer = { state: 'ok', reviewer: 'Mani', current: null }
      await unmount()
    })

    it('says why a set-up was turned down, and offers to send it again (#1195)', async () => {
      setupAnswer = { state: 'ok', reviewer: 'the master data team', reviewer_is_team: true, current: { state: 'turned_down', name: 'Ladies', reason: 'Bags is in Kids.' } }
      const { container, unmount } = await refusing(['departments_not_filled'])
      expect(container.querySelector('[data-testid=reach-title]')?.textContent).toBe("Your department wasn't kept")
      expect(container.querySelector('[data-testid=department-turned-down]')?.textContent).toBe("The master data team didn't keep “Ladies”: Bags is in Kids. Change it and send it again.")
      expect(container.querySelector('[data-testid=department-link]')?.textContent).toBe('Change and send again')
      setupAnswer = { state: 'ok', reviewer: 'the master data team', reviewer_is_team: true, current: { state: 'turned_down', name: 'Ladies', reason: '' } }
      await unmount()
      const again = await refusing(['departments_not_filled'])
      expect(again.container.querySelector('[data-testid=department-turned-down]')?.textContent).toBe("The master data team didn't keep “Ladies”. Change it and send it again.")
      setupAnswer = { state: 'ok', reviewer: 'the master data team', reviewer_is_team: true, current: null }
      await again.unmount()
      const team = await refusing(['departments_not_filled'])
      expect(team.container.querySelector('[data-testid=department-reviewer]')?.textContent).toBe('The master data team reviews it.')
      setupAnswer = { state: 'ok', reviewer: 'Mani', current: null }
      await team.unmount()
    })

    it("says a store with no sections waits for the master data team, with no button (#1195)", async () => {
      const { container, unmount } = await refusing(['store_sections_not_set_up'])
      expect(container.querySelector('[data-testid=reach-title]')?.textContent).toBe("Your store's sections aren't set up yet")
      expect(container.querySelector('[data-testid=department-link]')).toBeNull()
      await unmount()
    })

    // #1172: Dash opens for Head office staff (a Dash role), and says why there is no store report.
    it('tells Head office staff why there is no store report, instead of the generic no-access notice', async () => {
      const { container, unmount } = await refusing(['head_office'])
      expect([container.querySelector('[data-testid=reach-problem]')?.textContent?.startsWith('Your job is in head office'), container.querySelector('[data-testid=no-access]')])
        .toEqual([true, null])
      await unmount()
    })
  })
})

// #1205: a pre-filled Department Manager's report opens with the question above it.
describe('a pre-filled department on the report page (#1205)', () => {
  const PREFILLED = { state: 'ok', job: { id: 'J1', store: 'Lakeside' }, reviewer: 'Mani', current: { state: 'set_up', name: 'Womenswear', sections: ['Sarees'],
    reviewing: { bundle: 'B1', waiting_for: 'Mani' }, prefilled: { bundle: 'B1', sections: [{ id: 'S1', name: 'Sarees' }], flagged: [] } } }
  afterEach(() => { holdsAnswer = false; setupAnswer = { state: 'ok', reviewer: 'Mani', current: null } })
  async function show() {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Dash } = await import('./app')
    history.replaceState(null, '', '?store=9901')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<Dash />) })
    await act(async () => { await settle() })
    return { container, act, unmount: () => act(async () => root.unmount()) }
  }

  it('asks a pre-filled Department Manager whether it is right; Yes makes it theirs and says who reviews it', async () => {
    holdsAnswer = true
    setupAnswer = PREFILLED
    const { container, act, unmount } = await show()
    expect(container.querySelector('[data-testid=prefill-banner]')?.textContent).toContain('Your report shows Sarees: the sections your Team Leaders run. Is this right?')
    expect(container.querySelector('[data-testid=prefill-banner] a')?.getAttribute('href')).toBe('?view=department')
    const yes = [...container.querySelectorAll('button')].find(b => b.textContent === "Yes, that's right")!
    await act(async () => { yes.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await settle() })
    const sent = calls.find(c => c.name === 'set_up_department')!
    expect(sent.payload).toEqual({ job: 'J1', name: 'Womenswear', sections: ['S1'], replaces: 'B1' })
    await act(async () => { sent.answer.resolve({ state: 'set_up' }); await settle() })
    expect(container.querySelector('[data-testid=prefill-banner]')).toBeNull()
    expect(container.querySelector('[data-testid=prefill-done]')?.textContent).toBe('Thank you. It is your department now; Mani reviews it.')
    await unmount()
  })
  it('as one line, Change it still leads to Your department', async () => {
    holdsAnswer = true
    setupAnswer = PREFILLED
    window.localStorage.setItem('dash.prefill-banner', 'line')
    const { container, unmount } = await show()
    expect(container.querySelector('[data-testid=prefill-line] a')?.getAttribute('href')).toBe('?view=department')
    window.localStorage.clear()
    await unmount()
  })
  it('asks nothing of anyone else, nor of a Department Manager whose department is their own', async () => {
    const other = await show()
    expect(other.container.querySelector('[data-testid=prefill-banner]')).toBeNull()
    expect(calls.some(c => c.name === 'department_setup')).toBe(false)
    await other.unmount()
    holdsAnswer = true
    setupAnswer = { ...PREFILLED, current: { ...PREFILLED.current, prefilled: undefined } }
    const own = await show()
    expect(own.container.querySelector('[data-testid=prefill-banner]')).toBeNull()
    await own.unmount()
  })
})

