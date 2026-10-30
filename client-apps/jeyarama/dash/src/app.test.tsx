// The report page rendered by React, in a DOM (jsdom from this repository's apps/web: no test
// dependency of the app's own), with the platform's reads played
// by a stand-in `fetch` (the network boundary). Codex round 8: choosing a store invalidates the
// previous store's answers AT ONCE, so an answer that lands between the choice and React's
// effect never draws the previous store's figures under the new one. Made-up stores and figures.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type Deferred = { resolve: (body: unknown) => void }
const calls: { name: string; store?: string; answer: Deferred }[] = []
let teardown: () => void = () => {}

beforeAll(() => {
  // This repository's root (client-apps/jeyarama/dash/src → four levels up), with `pnpm install` run.
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Record<string, unknown> & { close(): void } } }
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/feather_dash/?store=9901' })
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
    const store = (JSON.parse(String(init.body)).payload ?? {}).store
    return new Promise(resolveCall => {
      const answer: Deferred = { resolve: body => resolveCall(new Response(JSON.stringify({ result: body }), { status: 200 })) }
      calls.push({ name, store, answer })
      if (name === 'stores') answer.resolve([{ value: '9901', label: 'Lakeside · 9901' }, { value: '9902', label: 'Hillview · 9902' }])
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
    const { FeatherDash } = await import('./app')
    const container = document.getElementById('root')!
    const drawn: string[] = []
    const observer = new MutationObserver(records => {
      for (const r of records) for (const node of r.addedNodes) drawn.push(node.textContent ?? '')
    })
    observer.observe(container, { childList: true, subtree: true, characterData: true })
    await act(async () => { createRoot(container).render(<FeatherDash />) })
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
  async function openOn9901({ answer = true } = {}) {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { FeatherDash } = await import('./app')
    history.replaceState(null, '', '?store=9901')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<FeatherDash />) })
    await act(async () => { await settle() })
    const answerAll = async () => {
      for (const c of calls.filter(c => c.store === '9901'))
        c.answer.resolve(c.name === 'report' ? report('9901', 'Lakeside silk') : { not_set_up: true })
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
    expect(container.querySelector('[data-testid=feather-dash]')?.getAttribute('data-view')).toBe('quick')
    await unmount()
  })

  it('stays on its figures when history moves between two addresses of the same store', async () => {
    const { act, container, unmount } = await openOn9901()
    await act(async () => {
      history.pushState(null, '', '?store=9901&from=back')
      window.dispatchEvent(new (DomEvent().PopStateEvent)('popstate'))
      await settle()
    })
    expect(container.querySelector('[data-testid=feather-dash]')?.getAttribute('data-view')).toBe('quick')
    await unmount()
  })

  it('still reaches its figures when the bar repeats the store while it is loading', async () => {
    const { act, container, answerAll, unmount } = await openOn9901({ answer: false })
    await act(async () => {
      window.dispatchEvent(new (DomEvent().CustomEvent)('featherbase:bar-change', { detail: { key: 'store', value: '9901' } }))
      await settle()
    })
    await answerAll()
    expect(container.querySelector('[data-testid=feather-dash]')?.getAttribute('data-view')).toBe('quick')
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
    expect(container.querySelector('[data-testid=feather-dash]')?.getAttribute('data-view')).toBe('quick')
    await unmount()
  })
})


// #4486: the header says why the reader sees the store on show, and follows the bar's store picker.
describe("the page's header", () => {
  const withHeading = (store: string, heading: unknown) => ({ ...report(store, `Silk ${store}`), heading })
  const text = (container: Element, id: string) => container.querySelector(`[data-testid=${id}]`)?.textContent ?? null

  it('says why the reader sees the store chosen, under the period and above the measure, and changes with the store', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { FeatherDash } = await import('./app')
    history.replaceState(null, '', '?store=9901')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<FeatherDash />) })
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

  it('draws the header above the Dive too', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { FeatherDash } = await import('./app')
    history.replaceState(null, '', '?store=9901')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<FeatherDash />) })
    await act(async () => { await settle() })
    for (const c of calls.filter(c => c.store === '9901'))
      c.answer.resolve(c.name === 'report' ? withHeading('9901', { name: 'LKS', sections: [], reasons: [{ basis: 'store_manager', sections: [] }] })
        : { frame: 'https://embed-motherduck.com/sandbox/#session=made-up' })
    await act(async () => { await settle() })
    expect(container.querySelector('[data-testid=feather-dash]')?.getAttribute('data-view')).toBe('dive')
    expect(text(container, 'why-line')).toBe('You see LKS because you are its Store Manager.')
    await act(async () => root.unmount())
  })

  it('leaves the sentence out, not an empty line, when no reason is known', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { FeatherDash } = await import('./app')
    history.replaceState(null, '', '?store=9901')
    calls.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<FeatherDash />) })
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
