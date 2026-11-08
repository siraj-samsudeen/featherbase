// Your sections and Waiting for your approval, rendered in a DOM (jsdom from apps/web), with the
// platform's answers played by a stand-in `fetch`. The rules themselves are proved on the real
// platform in platform-test/my-sections.test.ts. Made-up people and stores.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { askedFor, currentView, outcome } from './sections-page'

// Shop Floor's icons come with the workspace's copy of React; the real page bundles one. An icon
// says nothing these tests read, so here each draws nothing.
vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

type Call = { kind: 'reads' | 'actions'; name: string; payload: Record<string, unknown> }
const calls: Call[] = []
let answers: Record<string, unknown> = {}
let teardown: () => void = () => {}

beforeAll(() => {
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Record<string, unknown> & { close(): void } } }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dash/?view=sections' })
  const added: string[] = []
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue
    Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] })
    added.push(key)
  }
  for (const key of ['window', 'document', 'navigator', 'location', 'history'])
    Object.defineProperty(globalThis, key, { configurable: true, get: () => (key === 'window' ? dom.window : dom.window[key]) })
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).fetch = async (url: string, init: RequestInit) => {
    const [, kind, name] = /app_(reads|actions)\/dash\/(.+)$/.exec(String(url))!
    const body = JSON.parse(String(init.body))
    calls.push({ kind: kind as Call['kind'], name, payload: body.payload })
    const answer = name === 'reports' ? answers[name] ?? [] : answers[name]
    if (answer instanceof Error) return new Response(JSON.stringify({ error: { message: answer.message } }), { status: 417 })
    return new Response(JSON.stringify({ result: answer ?? { state: 'ok', proposals: [] } }), { status: 200 })
  }
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())
beforeEach(() => { calls.length = 0; answers = {}; document.body.innerHTML = '' })

const job = {
  id: 'job-row', job: 'Team Leader', store: 'Lakeside', is_store: true, reports_to: 'Mani Manager', waiting_for: 'Mani Manager',
  section: { id: 'section-row', name: 'Ladies Wear', floor: 'First floor' },
  subcategories: [{ id: 'placement-row', name: 'Sarees' }],
  other_sections: [{ id: 'silk-row', name: 'Silk', floor: 'Second floor' }],
}
const pending = { id: 'p1', kind: 'move', what: 'Sarees', from: 'Ladies Wear', to: 'Silk', store: 'Lakeside', state: 'Pending', waiting_for: 'Mani Manager', reason: null, asked_on: '2026-11-05', decided_on: '', who: 'Asha Maker' }

async function render(page: 'YourSections' | 'Approvals') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const module = await import('./sections-page')
  const Page = module[page]
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<Page />) })
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  const q = (testid: string) => container.querySelector(`[data-testid="${testid}"]`)
  const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label) as HTMLButtonElement
  const click = async (label: string) => {
    await act(async () => { button(label).dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  }
  const choose = async (element: HTMLSelectElement | HTMLInputElement, value: string) => {
    const proto = element instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
      element.dispatchEvent(new window.Event(element instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    })
  }
  return { container, q, button, click, choose, done: () => act(async () => root.unmount()) }
}

describe('wording', () => {
  it('says what was asked for, in one sentence', () => {
    expect(askedFor({ kind: 'move', what: 'Sarees', from: 'Ladies Wear', to: 'Silk' })).toBe('Move Sarees from Ladies Wear to Silk')
    expect(askedFor({ kind: 'add', what: 'Sarees', from: 'No section', to: 'Silk' })).toBe('Add Sarees to Silk')
    expect(askedFor({ kind: 'section', what: 'Team Leader at Lakeside', from: 'Silk', to: 'Linen' })).toBe('Change section from Silk to Linen')
    expect(askedFor({ kind: 'section', what: 'Team Leader at Lakeside', from: 'No section', to: 'Linen' })).toBe('Set your section to Linen')
  })
  it('says the outcome', () => {
    expect(outcome({ state: 'Pending', waiting_for: 'Mani Manager' }).label).toBe('Waiting for Mani Manager')
    expect(outcome({ state: 'Applied', waiting_for: '' }).label).toBe('Approved')
    expect(outcome({ state: 'Rejected', waiting_for: '' }).label).toBe('Rejected')
    expect(outcome({ state: 'Needs fresh review', waiting_for: '' }).label).toBe('Needs asking again')
  })
  it('reads the page from the address, the report by default', () => {
    expect(currentView('?view=sections')).toBe('sections')
    expect(currentView('?view=approvals')).toBe('approvals')
    expect(currentView('?store=9901')).toBe('report')
    expect(currentView('?view=other')).toBe('report')
  })
})

describe('Your sections', () => {
  it('shows the job, manager, section and subcategories, and a move sends the ids the server needs', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [job], proposals: [] }
    answers.propose_move = pending
    const page = await render('YourSections')
    expect(page.q('person-name')?.textContent).toContain('Asha Maker')
    expect(page.q('job-card')?.textContent).toContain('Team Leader · Lakeside')
    expect(page.q('reports-to')?.textContent).toBe('You report to Mani Manager')
    expect(page.q('section-name')?.textContent).toBe('Ladies Wear · First floor')
    expect(page.q('subcategories')?.textContent).toContain('Sarees')
    // No raw id reaches the reader.
    expect(page.container.textContent).not.toMatch(/-row/)
    await page.click('Not in my section')
    // Nothing chosen yet: nothing is sent.
    await page.click('Send for approval')
    expect(page.q('pick-section')?.textContent).toContain('Pick a section')
    expect(calls.filter(c => c.kind === 'actions')).toEqual([])
    await page.choose(page.q('pick-section')!.querySelector('select')!, 'silk-row')
    await page.click('Send for approval')
    expect(calls.find(c => c.kind === 'actions')).toEqual({ kind: 'actions', name: 'propose_move', payload: { job: 'job-row', to_section: 'silk-row', placement: 'placement-row' } })
    expect(page.q('sent-note')?.textContent).toContain('Sent to Mani Manager')
    await page.done()
  })

  it('a refusal is said where the person is, and the form stays', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [job], proposals: [] }
    answers.propose_section = new Error('You have already asked for this')
    const page = await render('YourSections')
    await page.click('My section is wrong')
    await page.choose(page.q('pick-section')!.querySelector('select')!, 'silk-row')
    await page.click('Send for approval')
    expect(page.q('pick-section')?.textContent).toContain('You have already asked for this')
    await page.done()
  })

  it('shows what was asked for and how it ended', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [job], proposals: [pending,
      { ...pending, id: 'p2', state: 'Rejected', reason: 'Sarees stay here', decided_on: '2026-11-05' }, { ...pending, id: 'p3', state: 'Applied', decided_on: '2026-11-05' }] }
    const page = await render('YourSections')
    const text = page.q('your-proposals')?.textContent
    expect(text).toContain('Move Sarees from Ladies Wear to Silk')
    expect(text).toContain('Waiting for Mani Manager')
    expect(text).toContain('Sarees stay here')
    expect(text).toContain('05-Nov-2026')
    expect(text).toContain('Approved')
    await page.done()
  })

  it('says what to do when there is nothing to show', async () => {
    answers.my_sections = { state: 'unknown_person' }
    let page = await render('YourSections')
    expect(page.q('unknown-person')?.textContent).toContain('Ask your manager')
    await page.done()
    answers.my_sections = { state: 'not_set_up' }
    page = await render('YourSections')
    expect(page.q('not-set-up')).toBeTruthy()
    await page.done()
    answers.my_sections = { state: 'ok', name: 'Asha', jobs: [{ ...job, section: null, subcategories: [] }], proposals: [] }
    page = await render('YourSections')
    expect(page.q('no-section')?.textContent).toContain('No section is set against your job')
    await page.done()
    answers.my_sections = { state: 'ok', name: 'Asha', jobs: [{ ...job, section: null, subcategories: [], other_sections: [] }], proposals: [] }
    page = await render('YourSections')
    expect(page.q('store-no-sections')?.textContent).toContain('This store has no sections set up yet')
    await page.done()
    answers.my_sections = { state: 'ok', name: 'Asha', jobs: [{ ...job, is_store: false, reports_to: null, section: null, subcategories: [], other_sections: [] }], proposals: [] }
    page = await render('YourSections')
    expect(page.q('store-no-sections')?.textContent).toBe('This job is not in a store, so it has no sections.')
    await page.done()
  })

  it('offers the approvals page only when something waits', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha', jobs: [], proposals: [], waiting_for_me: 0 }
    let page = await render('YourSections')
    expect(page.q('approvals-link')).toBeNull()
    expect(page.q('approvals-notice')).toBeNull()
    await page.done()
    answers.my_sections = { state: 'ok', name: 'Asha', jobs: [], proposals: [], waiting_for_me: 1 }
    page = await render('YourSections')
    expect(page.q('approvals-link')?.textContent).toContain('Waiting for your approval (1)')
    expect(page.q('approvals-notice')?.textContent).toBe('1 change is waiting for your approval')
    await page.done()
  })
})

describe('Waiting for your approval', () => {
  it('shows who, what, from and to, and Approve decides', async () => {
    answers.approvals = { state: 'ok', proposals: [pending] }
    answers.decide = { ...pending, state: 'Applied' }
    const page = await render('Approvals')
    expect(page.q('approval-who')?.textContent).toBe('Asha Maker · Lakeside')
    expect(page.q('approval-what')?.textContent).toBe('Move Sarees from Ladies Wear to Silk')
    await page.click('Approve')
    expect(calls.find(c => c.kind === 'actions')).toEqual({ kind: 'actions', name: 'decide', payload: { proposal: 'p1', decision: 'approve' } })
    await page.done()
  })

  it('Reject needs a reason', async () => {
    answers.approvals = { state: 'ok', proposals: [pending] }
    answers.decide = { ...pending, state: 'Rejected' }
    const page = await render('Approvals')
    await page.click('Reject')
    await page.click('Reject')
    expect(calls.filter(c => c.kind === 'actions')).toEqual([])
    expect(page.q('approval')?.textContent).toContain('Say why')
    await page.choose(page.q('approval')!.querySelector('input')!, 'It belongs where it is')
    await page.click('Reject')
    expect(calls.find(c => c.kind === 'actions')?.payload).toEqual({ proposal: 'p1', decision: 'reject', reason: 'It belongs where it is' })
    await page.done()
  })

  it('a stale proposal says nothing was done, and a refusal refreshes the list', async () => {
    answers.approvals = { state: 'ok', proposals: [pending] }
    answers.decide = { ...pending, state: 'Needs fresh review' }
    let page = await render('Approvals')
    await page.click('Approve')
    expect(page.q('decision-note')?.textContent).toContain('nothing was done')
    await page.done()
    answers.decide = new Error('This has already been decided')
    page = await render('Approvals')
    const before = calls.filter(c => c.name === 'approvals').length
    await page.click('Approve')
    expect(page.q('decision-note')?.textContent).toContain('This has already been decided')
    expect(calls.filter(c => c.name === 'approvals').length).toBeGreaterThan(before)
    await page.done()
  })

  it('the sidebar count follows the list', async () => {
    answers.approvals = { state: 'ok', proposals: [pending, { ...pending, id: 'p2' }] }
    const page = await render('Approvals')
    expect(page.q('approvals-link')?.textContent).toContain('(2)')
    answers.approvals = { state: 'ok', proposals: [{ ...pending, id: 'p2' }] }
    answers.decide = { ...pending, state: 'Applied' }
    await page.click('Approve')
    expect(page.q('approvals-link')?.textContent).toContain('(1)')
    await page.done()
  })

  it('a section proposal reads as being about them', async () => {
    answers.approvals = { state: 'ok', proposals: [{ ...pending, kind: 'section', what: 'Staff at Lakeside', from: 'No section', to: 'Silk' }] }
    const page = await render('Approvals')
    expect(page.q('approval-what')?.textContent).toBe('Set their section to Silk')
    await page.done()
  })

  it('an empty list says so', async () => {
    const page = await render('Approvals')
    expect(page.q('nothing-waiting')?.textContent).toContain('Nothing is waiting for you')
    await page.done()
  })
})

// #967's UI checklist: the Reports group lists what the reader may open.
describe("Dash's sidebar", () => {
  const REPORTS = [{ key: 'sales', name: 'Sales versus target', takes_store: true, takes_month: true }, { key: 'whole', name: 'Store target month to date', takes_store: false, takes_month: false }]
  const links = () => [...document.querySelectorAll('[data-testid=report-link]')]
  async function sidebar(address: string, current: 'report' | 'sections' = 'report') {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { DashSidebar } = await import('./sections-page')
    history.replaceState(null, '', address)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<DashSidebar current={current} />) })
    await act(async () => { await Promise.resolve() })
    return container
  }

  it('lists each report by name, above Your sections', async () => {
    answers = { reports: REPORTS }
    const container = await sidebar('/dash/')
    const texts = [...container.querySelectorAll('featherbase-sidebar > *')].map(e => e.textContent)
    expect(texts).toEqual(['Reports', 'Sales versus target', 'Store target month to date', 'Your sections'])
  })

  it('marks the first report when the address names none, and the one it names otherwise', async () => {
    answers = { reports: REPORTS }
    await sidebar('/dash/')
    expect(links().map(a => a.getAttribute('aria-current'))).toEqual(['page', null])
    document.body.innerHTML = ''
    await sidebar('/dash/?report=whole')
    expect(links().map(a => a.getAttribute('aria-current'))).toEqual([null, 'page'])
  })

  it('keeps the store chosen in each report\'s address', async () => {
    answers = { reports: REPORTS }
    await sidebar('/dash/?store=9901&report=sales')
    expect(links().map(a => a.getAttribute('href'))).toEqual(['?store=9901&report=sales', '?store=9901&report=whole'])
  })

  it('marks no report on another page, and leaves that page behind in the address', async () => {
    answers = { reports: REPORTS }
    await sidebar('/dash/?view=sections', 'sections')
    expect(links().map(a => [a.getAttribute('aria-current'), a.getAttribute('href')])).toEqual([[null, '?report=sales'], [null, '?report=whole']])
  })

  it('draws no Reports group for someone with none', async () => {
    answers = { reports: [] }
    await sidebar('/dash/')
    expect(document.querySelector('[data-testid=reports-group]')).toBeNull()
  })
})
