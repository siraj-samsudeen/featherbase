// #1246: a category head's Buyer Sections and the master data team's decisions, rendered in a DOM (jsdom
// from apps/web) with the platform's answers played by a stand-in fetch. Made-up people and codes.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { ReactElement } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

let teardown: () => void = () => {}
const calls: { name: string; payload: Record<string, unknown> }[] = []
beforeAll(() => {
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Record<string, unknown> & { close(): void } } }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dash/?view=store' })
  const added: string[] = []
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue
    Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] })
    added.push(key)
  }
  for (const key of ['window', 'document', 'navigator', 'location', 'history'])
    Object.defineProperty(globalThis, key, { configurable: true, get: () => (key === 'window' ? dom.window : dom.window[key]) })
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).fetch = async (url: string, init?: RequestInit) => {
    const name = String(url).split('/').pop()!.split(':')[0]
    const payload = init?.body ? JSON.parse(String(init.body)).payload : {}
    calls.push({ name, payload })
    return new Response(JSON.stringify({ result: name === 'dash_pages_open' ? [] : { state: 'Pending' } }), { status: 200 })
  }
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())

const ANSWER = {
  buyerSections: [
    { id: 'BS-SALWAR', name: 'Salwar', region: 'East', buyer: { code: 'E11', name: 'Sara Buyer' }, subcategories: [] },
    { id: 'BS-KURTI', name: 'Women Kurti', region: 'East', buyer: null, subcategories: [{ code: '010505001', name: 'Churidar', link: 'L2' }, { code: '010505003', name: 'Women Kurti', link: 'L1' }] },
    { id: 'BS-WEST', name: 'West Buyer Section', region: 'West', buyer: { code: 'E12', name: 'West Buyer' }, subcategories: [] },
  ],
  unplaced: [{ code: '010505009', name: 'Kurti Sets', region: 'East' }],
  waiting: [{ id: 'P1', subcategory: '010505003', subcategory_name: 'Women Kurti', region: 'East', from: 'Women Kurti', to: 'Salwar', applied: false, waiting_for: 'the master data team' }],
}

async function mount(node: () => Promise<ReactElement>) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  document.body.innerHTML = ''
  calls.length = 0
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const element = await node()
  await act(async () => { root.render(element) })
  const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  await settle()
  const choose = async (select: HTMLSelectElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }); await settle() }
  return { container, choose, click, done: () => act(async () => root.unmount()) }
}

describe("a category head's Buyer Sections", () => {
  it('offers each subcategory only their other Buyer Sections in the same region; a waiting move shows instead', async () => {
    const { YourBuyerSections } = await import('./buyer-sections-page')
    const { container, done } = await mount(async () => <YourBuyerSections answer={ANSWER} onChanged={async () => {}} />)
    const rows = [...container.querySelectorAll('[data-testid="buyer-subcategory"]')]
    const churidar = rows.find(r => r.textContent!.includes('Churidar'))!
    expect([...churidar.querySelectorAll('option')].map(o => o.textContent)).toEqual(['Move to…', 'Salwar (Sara Buyer)'])
    const kurti = rows.find(r => r.textContent!.startsWith('Women Kurti'))!
    expect(kurti.querySelector('select')).toBeNull()
    expect(kurti.textContent).toContain('Waiting for the master data team: to Salwar')
    expect(container.querySelector('[data-testid="no-buyer-yet"]')!.textContent).toBe('No buyer yet')
    const unplaced = container.querySelector('[data-testid="buyer-unplaced"]')!
    expect([...unplaced.querySelectorAll('option')].map(o => o.textContent)).toEqual(['Put in…', 'Salwar (Sara Buyer)', 'Women Kurti (no buyer yet)'])
    await done()
  })

  it('asks to move a subcategory and says the master data team decides', async () => {
    const { YourBuyerSections } = await import('./buyer-sections-page')
    const { container, choose, click, done } = await mount(async () => <YourBuyerSections answer={ANSWER} onChanged={async () => {}} />)
    const churidar = [...container.querySelectorAll('[data-testid="buyer-subcategory"]')].find(r => r.textContent!.includes('Churidar'))!
    await choose(churidar.querySelector('select')!, 'BS-SALWAR')
    await click(churidar.querySelector('[data-testid="move-buyer-subcategory"]')!)
    expect(calls.filter(c => c.name === 'move_buyer_subcategory').map(c => c.payload)).toEqual([{ subcategory: '010505001', to_section: 'BS-SALWAR' }])
    expect(container.querySelector('[data-testid="buyer-move-note"]')!.textContent).toBe('Asked to move Churidar to Salwar. The master data team decides.')
    await done()
  })

  it('shows what was decided on their moves, and why', async () => {
    const { YourBuyerSections } = await import('./buyer-sections-page')
    const decided = [{ id: 'P9', subcategory: '010505003', subcategory_name: 'Women Kurti', from: 'Women Kurti', to: 'Salwar', state: 'Rejected', reason: 'Kavin keeps Kurti', decided_on: '2026-11-16' }]
    const { container, done } = await mount(async () => <YourBuyerSections answer={{ ...ANSWER, decided }} onChanged={async () => {}} />)
    expect(container.querySelector('[data-testid="buyer-decided-row"]')!.textContent).toBe('Turned down · Move Women Kurti from Women Kurti to Salwar · 16-Nov-2026“Kavin keeps Kurti”')
    await done()
  })

  it("a move waiting in the East leaves the same subcategory's West row free to move (Codex)", async () => {
    const { YourBuyerSections } = await import('./buyer-sections-page')
    const both = { ...ANSWER, buyerSections: [...ANSWER.buyerSections.slice(0, 2), { id: 'BS-WEST', name: 'West Buyer Section', region: 'West', buyer: { code: 'E12', name: 'West Buyer' },
      subcategories: [{ code: '010505003', name: 'Women Kurti', link: 'LW' }] }, { id: 'BS-WEST2', name: 'West two', region: 'West', buyer: null, subcategories: [] }],
      waiting: [{ ...ANSWER.waiting[0], region: 'East' }] }
    const { container, done } = await mount(async () => <YourBuyerSections answer={both} onChanged={async () => {}} />)
    const kurtis = [...container.querySelectorAll('[data-testid="buyer-subcategory"]')].filter(r => r.textContent!.startsWith('Women Kurti'))
    expect(kurtis.map(r => !!r.querySelector('select'))).toEqual([false, true])
    await done()
  })

  it('shows nothing for someone who heads no Buyer Section', async () => {
    const { YourBuyerSections } = await import('./buyer-sections-page')
    const { container, done } = await mount(async () => <YourBuyerSections answer={{ buyerSections: [], unplaced: [], waiting: [] }} onChanged={async () => {}} />)
    expect(container.innerHTML).toBe('')
    await done()
  })
})

describe("the master data team's Buyer Section changes", () => {
  const MOVE = { id: 'P1', who: 'Hema Head', subcategory: '010505001', subcategory_name: 'Churidar', region: 'East', from: 'Women Kurti', to: 'Salwar', applied: false, asked_on: '2026-11-16' }
  it('reads as the move asked for, and keeps it', async () => {
    const { BuyerSectionApprovals } = await import('./buyer-sections-page')
    const said: string[] = []
    const { container, click, done } = await mount(async () => <BuyerSectionApprovals moves={[MOVE, { ...MOVE, id: 'P2', from: null, subcategory_name: 'Kurti Sets' }]} onDecided={async text => { said.push(text) }} />)
    expect([...container.querySelectorAll('[data-testid="buyer-move-ask"]')].map(e => e.textContent)).toEqual(['Move Churidar from Women Kurti to Salwar · East', 'Put Kurti Sets into Salwar · East'])
    await click(container.querySelector('[data-testid="buyer-keep"]')!)
    expect(calls.filter(c => c.name === 'decide_buyer_section').map(c => c.payload)).toEqual([{ proposal: 'P1', decision: 'approve' }])
    await done()
  })

  it('links each record on the card: the subcategory, both Buyer Sections and the region (verifier B12)', async () => {
    const { BuyerSectionApprovals } = await import('./buyer-sections-page')
    const { container, done } = await mount(async () => <BuyerSectionApprovals moves={[{ ...MOVE, who_code: 'E1', from_id: 'BS-KURTI', to_id: 'BS-SALWAR' }]} onDecided={async () => {}} />)
    const links = [...container.querySelectorAll('[data-testid="buyer-move-ask"] [data-record-link="link"]')].map(a => [a.getAttribute('data-table'), a.getAttribute('data-row')])
    expect(links).toEqual([['Subcategory', '010505001'], ['Buyer Section', 'BS-KURTI'], ['Buyer Section', 'BS-SALWAR'], ['Operating Region', 'East']])
    await done()
  })

  it('turns one down only with a reason', async () => {
    const { BuyerSectionApprovals } = await import('./buyer-sections-page')
    const { container, click, done } = await mount(async () => <BuyerSectionApprovals moves={[MOVE]} onDecided={async () => {}} />)
    await click([...container.querySelectorAll('button')].find(b => b.textContent === 'Turn down')!)
    expect((container.querySelector('[data-testid="buyer-confirm-reject"]') as HTMLButtonElement).disabled).toBe(true)
    await done()
  })
})
