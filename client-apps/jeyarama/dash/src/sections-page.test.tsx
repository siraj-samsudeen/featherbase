// Your sections and Waiting for your approval, rendered in a DOM (jsdom from apps/web), with the
// platform's answers played by a stand-in `fetch`. The rules themselves are proved on the real
// platform in platform-test/my-sections.test.ts. Made-up people and stores.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { askedFor, currentView, holderLine, outcome } from './sections-page'

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
    const answer = name === 'reports' || name === 'department_approvals' ? answers[name] ?? [] : answers[name]
    if (answer instanceof Error) return new Response(JSON.stringify({ error: { message: answer.message } }), { status: 417 })
    return new Response(JSON.stringify({ result: answer ?? { state: 'ok', proposals: [] } }), { status: 200 })
  }
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())
beforeEach(() => { calls.length = 0; answers = {}; document.body.innerHTML = '' })

const ETHNIC = { division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses' }
const job = {
  id: 'job-row', job: 'Team Leader', store: 'Lakeside', is_store: true, reports_to: 'Mani Manager', waiting_for: 'Mani Manager',
  section: { id: 'section-row', name: 'Ladies Wear', floor: 'First floor' },
  subcategories: [{ id: 'placement-row', code: '010101001', name: 'Sarees', ...ETHNIC, pending: null }],
  additions: [],
  other_sections: [{ id: 'silk-row', name: 'Silk', floor: 'Second floor' }],
}
const pending = { id: 'p1', kind: 'move', what: 'Sarees', from: 'Ladies Wear', to: 'Silk', store: 'Lakeside', state: 'Pending', waiting_for: 'Mani Manager', reason: null, asked_on: '2026-11-05', decided_on: '', who: 'Asha Maker' }
/** As the approvals read answers it: a move with both ends and the store's open sections. */
const move = { ...pending, from: { section: 'Silk', holder: 'Bala Holder' }, to: { section: 'Ladies Wear', holder: 'Asha Maker' }, path: ETHNIC,
  sections: [{ id: 'ladies-row', name: 'Ladies Wear', floor: 'First floor' }, { id: 'silk-row', name: 'Silk', floor: 'Second floor' }, { id: 'linen-row', name: 'Linen', floor: null }, { id: 'bags-row', name: 'Bags', floor: 'First floor' }] }

async function render(page: 'YourSections' | 'Approvals' | 'Unplaced') {
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
  /** Clicks an element no label names uniquely, such as one of several Undo buttons. */
  const press = async (element: Element) => {
    await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  }
  return { container, q, button, click, press, choose, done: () => act(async () => root.unmount()) }
}

describe('wording', () => {
  it('says what was asked for, in one sentence', () => {
    expect(askedFor({ kind: 'move', what: 'Sarees', from: 'Ladies Wear', to: 'Silk' })).toBe('Move Sarees from Ladies Wear to Silk')
    expect(askedFor({ kind: 'add', what: 'Sarees', from: 'No section', to: 'Silk' })).toBe('Add Sarees to Silk')
    expect(askedFor({ kind: 'removal', what: 'Sarees', from: 'Ladies Wear', to: '' })).toBe('Take Sarees out of Ladies Wear')
    expect(holderLine({ asked: false, holder: { kind: 'other', section: 'Silk', team_leader: 'Bala Holder' } })).toBe('Now in Silk · Bala Holder')
    expect(holderLine({ asked: false, holder: { kind: 'other', section: 'Silk', team_leader: null } })).toBe('Now in Silk')
    expect(holderLine({ asked: false, holder: { kind: 'none' } })).toBe('Not in any section')
    expect(holderLine({ asked: false, holder: { kind: 'mine' } })).toBe('Already yours')
    expect(holderLine({ asked: true, holder: { kind: 'none' } })).toBe('Already asked for')
    expect(holderLine({ asked: false, taken_out: true, holder: { kind: 'none' } })).toBe('You took this out · use Undo to put it back')
    expect(askedFor({ kind: 'section', what: 'Team Leader at Lakeside', from: 'Silk', to: 'Linen' })).toBe('Change section from Silk to Linen')
    expect(askedFor({ kind: 'section', what: 'Team Leader at Lakeside', from: 'No section', to: 'Linen' })).toBe('Set your section to Linen')
  })
  it('says the outcome', () => {
    expect(outcome({ state: 'Pending', waiting_for: 'Mani Manager' }).label).toBe('Waiting for Mani Manager')
    expect(outcome({ state: 'Applied', waiting_for: '' }).label).toBe('Approved')
    expect(outcome({ state: 'Rejected', waiting_for: '' }).label).toBe('Rejected')
    expect(outcome({ state: 'Needs fresh review', waiting_for: '' }).label).toBe('Needs asking again')
    expect(outcome({ state: 'Withdrawn', waiting_for: '' }).label).toBe('Withdrawn')
  })
  it('reads the page from the address, the report by default', () => {
    expect(currentView('?view=sections')).toBe('sections')
    expect(currentView('?view=approvals')).toBe('approvals')
    expect(currentView('?view=unplaced')).toBe('unplaced')
    expect(currentView('?store=9901')).toBe('report')
    expect(currentView('?view=other')).toBe('report')
  })
})

describe('Your sections', () => {
  it('shows the job, manager, section and its path once, and Not mine asks to remove it, with no destination', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [job], proposals: [] }
    answers.propose_removal = { ...pending, kind: 'removal' }
    const page = await render('YourSections')
    expect(page.q('person-name')?.textContent).toContain('Asha Maker')
    expect(page.q('job-card')?.textContent).toContain('Team Leader · Lakeside')
    expect(page.q('reports-to')?.textContent).toBe('You report to Mani Manager')
    expect(page.q('section-name')?.textContent).toBe('Ladies Wear · First floor')
    expect(page.q('subcategories')?.textContent).toContain('Sarees')
    expect(page.container.querySelectorAll('[data-testid="hierarchy-path"]')).toHaveLength(1)
    expect(page.q('hierarchy-path')?.textContent).toBe('Women›Ethnic Wear›Sarees and Blouses')
    // No raw id reaches the reader.
    expect(page.container.textContent).not.toMatch(/-row/)
    await page.click('Not mine')
    expect(calls.find(c => c.kind === 'actions')).toEqual({ kind: 'actions', name: 'propose_removal', payload: { job: 'job-row', placement: 'placement-row' } })
    expect(page.q('sent-note')?.textContent).toContain('Asked to take Sarees out of your section')
    await page.done()
  })

  it('a pending removal shows crossed out, an addition with a +, and Undo withdraws either', async () => {
    const asked = { ...job, subcategories: [{ ...job.subcategories[0], pending: { id: 'p-out', kind: 'removal', to: null, waiting_for: 'Mani Manager' } }],
      additions: [{ id: 'p-in', code: '010101004', name: 'Sari Blouses', ...ETHNIC, waiting_for: 'Mani Manager or Nila Other Manager' }] }
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [asked], proposals: [] }
    answers.withdraw = { ...pending, state: 'Withdrawn' }
    const page = await render('YourSections')
    const removed = page.q('subcategory')!
    expect(removed.querySelector('.line-through')?.textContent).toBe('Sarees')
    expect(removed.textContent).toContain('Removal waiting for approval')
    expect(page.q('addition')?.textContent).toContain('+ Sari Blouses')
    expect(page.q('addition')?.textContent).toContain('Addition waiting for approval')
    expect(page.q('addition')?.textContent).toContain('Waiting for Mani Manager or Nila Other Manager')
    await page.press(removed.querySelector('button')!)
    expect(calls.find(c => c.kind === 'actions')).toEqual({ kind: 'actions', name: 'withdraw', payload: { proposal: 'p-out' } })
    expect(page.q('sent-note')?.textContent).toContain('Undone: Sarees stays in your section.')
    await page.press(page.q('addition')!.querySelector('button')!)
    expect(calls.filter(c => c.kind === 'actions').at(-1)?.payload).toEqual({ proposal: 'p-in' })
    expect(page.q('sent-note')?.textContent).toContain('Undone: you are no longer asking to add Sari Blouses.')
    await page.done()
  })

  it('a section that mixes paths groups them, so two same names are told apart', async () => {
    const leggings = (id: string, subdivision: string) => ({ id, code: id, name: 'Girls Leggings', division: 'Kids', subdivision, category: 'Bottoms', pending: null })
    answers.my_sections = { state: 'ok', name: 'Asha', jobs: [{ ...job, subcategories: [leggings('w', 'Girls Western'), leggings('e', 'Girls Ethnic')] }], proposals: [] }
    const page = await render('YourSections')
    const groups = [...page.container.querySelectorAll('[data-testid="hierarchy-group"]')]
    expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['Kids › Girls Ethnic › Bottoms', 'Kids › Girls Western › Bottoms'])
    for (const group of groups) expect(group.textContent).toContain('Girls Leggings')
    await page.done()
  })

  it('Add subcategories browses from their own division, says who holds each, and asks for the ticked ones', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha', jobs: [job], proposals: [] }
    answers.subcategory_levels = { start: { division: 'Women', subdivision: 'Ethnic Wear' }, levels: [{ division: 'Kids', subdivision: 'Girls Ethnic', category: 'Bottoms' }, ETHNIC] }
    answers.category_subcategories = [
      { code: '010101001', name: 'Sarees', holder: { kind: 'mine' }, asked: false },
      { code: '010101003', name: 'Silk Sarees', holder: { kind: 'other', section: 'Silk', team_leader: 'Bala Holder' }, asked: false },
      { code: '010101004', name: 'Sari Blouses', holder: { kind: 'none' }, asked: false },
    ]
    answers.propose_adds = [pending, pending]
    const page = await render('YourSections')
    await page.click('Add subcategories')
    const browser = page.q('add-subcategories')!
    expect((browser.querySelectorAll('select')[0] as HTMLSelectElement).value).toBe('Women')
    expect(calls.find(c => c.name === 'category_subcategories')?.payload).toEqual({ job: 'job-row', ...ETHNIC })
    expect(browser.textContent).toContain('Now in Silk · Bala Holder')
    expect(browser.textContent).toContain('Not in any section')
    const boxes = [...browser.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(boxes[0].disabled).toBe(true)
    expect(page.button('Ask to add').disabled).toBe(true)
    for (const box of boxes.slice(1)) await page.press(box)
    await page.click('Ask to add 2')
    expect(calls.find(c => c.kind === 'actions')).toEqual({ kind: 'actions', name: 'propose_adds', payload: { job: 'job-row', subcategories: ['010101003', '010101004'] } })
    expect(page.q('sent-note')?.textContent).toContain('Asked to add 2 subcategories')
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
      { ...pending, id: 'p2', state: 'Rejected', reason: 'Sarees stay here', decided_on: '2026-11-05' }, { ...pending, id: 'p3', state: 'Applied', decided_on: '2026-11-05' }, { ...pending, id: 'p4', state: 'Withdrawn', decided_on: '2026-11-06' }] }
    const page = await render('YourSections')
    const text = page.q('your-proposals')?.textContent
    expect(text).toContain('Move Sarees from Ladies Wear to Silk')
    expect(text).toContain('Waiting for Mani Manager')
    expect(text).toContain('Sarees stay here')
    expect(text).toContain('05-Nov-2026')
    expect(text).toContain('Approved')
    expect(text).toContain('Withdrawn on 06-Nov-2026')
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
    expect(page.q('approvals-link')?.textContent).toContain('Waiting for you (1)')
    expect(page.q('approvals-notice')?.textContent).toBe('1 change is waiting for your approval')
    await page.done()
  })
})

describe('Waiting for your approval', () => {
  it('a move shows from and to with who holds each, and the path; Approve move decides', async () => {
    answers.approvals = { state: 'ok', proposals: [move] }
    answers.decide = { ...pending, state: 'Applied' }
    const page = await render('Approvals')
    expect(page.q('approval-who')?.textContent).toBe('Asha Maker · Lakeside')
    expect(page.q('approval-what')?.textContent).toBe('Move Sarees')
    expect(page.q('approval-move')?.textContent).toBe('FromSilkBala Holder→ToLadies WearAsha Maker')
    expect(page.q('hierarchy-path')?.textContent).toBe('Women›Ethnic Wear›Sarees and Blouses')
    await page.click('Approve move')
    expect(calls.find(c => c.kind === 'actions')).toEqual({ kind: 'actions', name: 'decide', payload: { proposal: 'p1', decision: 'approve' } })
    await page.done()
  })

  it('Move it elsewhere sends the section the approver picks', async () => {
    answers.approvals = { state: 'ok', proposals: [move] }
    answers.decide = { ...pending, state: 'Applied' }
    const page = await render('Approvals')
    await page.click('Move it elsewhere…')
    const select = page.q('approval')!.querySelector('select')!
    // Not back where it is now.
    // Neither where it is now nor where it was asked for: that is Approve move.
    expect([...select.options].map(o => o.textContent)).toEqual(['Choose a section', 'Linen', 'Bags · First floor'])
    await page.click('Move it there')
    expect(calls.filter(c => c.kind === 'actions')).toEqual([])
    await page.choose(select, 'linen-row')
    await page.click('Move it there')
    expect(calls.find(c => c.kind === 'actions')?.payload).toEqual({ proposal: 'p1', decision: 'approve', to_section: 'linen-row' })
    expect(page.q('decision-note')?.textContent).toBe('Approved: Sarees is now in Linen.')
    await page.done()
  })

  it('a removal says where it leaves the subcategory, and offers no elsewhere', async () => {
    answers.approvals = { state: 'ok', proposals: [{ ...move, kind: 'removal', from: { section: 'Ladies Wear', holder: 'Asha Maker' }, to: null, sections: [] }] }
    const page = await render('Approvals')
    expect(page.q('approval-what')?.textContent).toBe('Take Sarees out of Ladies Wear')
    expect(page.q('approval-removal')?.textContent).toBe('If you approve, it will be in no section at Lakeside until someone adds it. The master data team sees it on their list.')
    expect(page.button('Move it elsewhere…')).toBeUndefined()
    expect(page.button('Approve')).toBeTruthy()
    await page.done()
  })

  it('Reject needs a reason', async () => {
    answers.approvals = { state: 'ok', proposals: [move] }
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
    answers.approvals = { state: 'ok', proposals: [move] }
    answers.decide = { ...pending, state: 'Needs fresh review' }
    let page = await render('Approvals')
    await page.click('Approve move')
    expect(page.q('decision-note')?.textContent).toContain('nothing was done')
    await page.done()
    answers.decide = new Error('This has already been decided')
    page = await render('Approvals')
    const before = calls.filter(c => c.name === 'approvals').length
    await page.click('Approve move')
    expect(page.q('decision-note')?.textContent).toContain('This has already been decided')
    expect(calls.filter(c => c.name === 'approvals').length).toBeGreaterThan(before)
    await page.done()
  })

  it('the sidebar count follows the list', async () => {
    answers.approvals = { state: 'ok', proposals: [move, { ...move, id: 'p2' }] }
    const page = await render('Approvals')
    expect(page.q('approvals-link')?.textContent).toContain('(2)')
    answers.approvals = { state: 'ok', proposals: [{ ...move, id: 'p2' }] }
    answers.decide = { ...pending, state: 'Applied' }
    await page.click('Approve move')
    expect(page.q('approvals-link')?.textContent).toContain('(1)')
    await page.done()
  })

  it('a section proposal reads as being about them', async () => {
    answers.approvals = { state: 'ok', proposals: [{ ...move, kind: 'section', what: 'Staff at Lakeside', from: { section: 'No section', holder: null }, to: { section: 'Silk', holder: null }, path: null, sections: [] }] }
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

describe('Not in any section', () => {
  it("lists each store's subcategories in no section, under their path, for the master data team", async () => {
    answers.holds_master_data = true
    answers.unplaced = { state: 'ok', rows: [{ store: 'Lakeside', code: '010101001', name: 'Sarees', ...ETHNIC, was_in: 'Ladies Wear', since: '2026-11-10' }] }
    const page = await render('Unplaced')
    expect(page.q('unplaced-store')?.textContent).toContain('Lakeside')
    expect(page.q('unplaced-row')?.textContent).toBe('SareesOut of Ladies Wear since 10-Nov-2026')
    expect(page.q('unplaced-link')).toBeTruthy()
    await page.done()
  })

  it('says so to anyone else, and when every subcategory is in a section', async () => {
    answers.unplaced = { state: 'not_allowed' }
    let page = await render('Unplaced')
    expect(page.q('not-allowed')?.textContent).toContain('master data team')
    await page.done()
    answers.unplaced = { state: 'ok', rows: [] }
    page = await render('Unplaced')
    expect(page.q('nothing-unplaced')).toBeTruthy()
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

describe('a Department Manager on Your sections (#1195)', () => {
  it('sees their job point to Your department, and the sidebar offers it', async () => {
    answers.my_sections = { state: 'ok', name: 'Devi', jobs: [{ ...job, id: 'dm-job', job: 'Department Manager', section: null, subcategories: [] }], proposals: [], waiting_for_me: 0 }
    answers.holds_department_job = true
    const page = await render('YourSections')
    expect(page.q('department-job')?.textContent).toContain("A Department Manager's report shows their department's sections.")
    expect(page.q('department-job')?.querySelector('a')?.getAttribute('href')).toBe('?view=department')
    expect(page.q('department-link')?.getAttribute('href')).toBe('?view=department')
    expect(page.q('department-link')?.getAttribute('aria-current')).toBeNull()
    await page.done()
  })
  it('offers no Your department to anyone else', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha', jobs: [job], proposals: [], waiting_for_me: 0 }
    answers.holds_department_job = false
    const page = await render('YourSections')
    expect(page.q('department-link')).toBeNull()
    await page.done()
  })
})

// #1191: an instance where Your sections changes happen at once, and a reviewer confirms or undoes them.
const AT_ONCE = { add: true, removal: true, section: true }
const applied = { ...pending, state: 'Not yet reviewed', applied: true }

describe('apply now, review after (#1191)', () => {
  it('says changes happen at once only when every kind does', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [job], proposals: [], applies_at_once: AT_ONCE }
    let page = await render('YourSections')
    expect(page.q('person-name')?.textContent).toBe('Asha Maker. If something here is wrong, change it. It changes at once, and your manager reviews it afterwards.')
    await page.done()
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [job], proposals: [], applies_at_once: { ...AT_ONCE, section: false } }
    page = await render('YourSections')
    expect(page.q('person-name')?.textContent).toBe('Asha Maker. If something here is wrong, say so. Nothing changes until it is approved.')
    await page.done()
  })

  it('Not mine is done at once: the row stays struck through, waiting for review, with Undo', async () => {
    const out = { ...job, subcategories: [{ ...job.subcategories[0], pending: { id: 'p-out', kind: 'removal', to: null, waiting_for: 'Mani Manager', applied: true } }] }
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [out], proposals: [], applies_at_once: AT_ONCE }
    answers.withdraw = { ...applied, kind: 'removal', state: 'Undone' }
    const page = await render('YourSections')
    const row = page.q('subcategory')!
    expect(row.querySelector('.line-through')?.textContent).toBe('Sarees')
    expect(row.textContent).toContain('Taken out of your section · Mani Manager will review it')
    expect(row.textContent).toContain('Taken out · not yet reviewed')
    await page.press(row.querySelector('button')!)
    expect(calls.find(c => c.kind === 'actions')).toEqual({ kind: 'actions', name: 'withdraw', payload: { proposal: 'p-out' } })
    expect(page.q('sent-note')?.textContent).toBe('Undone: Sarees is back in your section.')
    await page.done()
  })

  it('Not mine says it is done, not asked for', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [job], proposals: [], applies_at_once: AT_ONCE }
    answers.propose_removal = { ...applied, kind: 'removal' }
    const page = await render('YourSections')
    await page.click('Not mine')
    expect(page.q('sent-note')?.textContent).toBe('Done: Sarees is out of your section. Mani Manager will review it.')
    await page.done()
  })

  it('an applied addition shows with a +, waiting for review, and Undo takes it out again', async () => {
    const added = { ...job, additions: [{ id: 'p-in', code: '010101004', name: 'Sari Blouses', ...ETHNIC, waiting_for: 'Mani Manager', applied: true }] }
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [added], proposals: [], applies_at_once: AT_ONCE }
    answers.withdraw = { ...applied, kind: 'add', state: 'Undone' }
    const page = await render('YourSections')
    expect(page.q('addition')?.textContent).toContain('+ Sari Blouses')
    expect(page.q('addition')?.textContent).toContain('Added to your section · Mani Manager will review it')
    expect(page.q('addition')?.textContent).toContain('Added · not yet reviewed')
    await page.press(page.q('addition')!.querySelector('button')!)
    expect(page.q('sent-note')?.textContent).toBe('Undone: Sari Blouses is out of your section again.')
    await page.done()
  })

  it('a section change done at once says what it was, with Undo; the form says it happens at once', async () => {
    const moved = { ...job, section_change: { id: 'p-sec', from: 'Silk', waiting_for: 'Mani Manager' } }
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [moved], proposals: [], applies_at_once: AT_ONCE }
    answers.withdraw = { ...applied, kind: 'section', state: 'Undone' }
    const page = await render('YourSections')
    expect(page.q('section-change')?.textContent).toContain('Changed from Silk · Mani Manager will review it')
    await page.click('My section is wrong')
    expect(page.q('pick-section')?.textContent).toContain('This changes at once. Mani Manager reviews it afterwards.')
    expect(page.button('Change it')).toBeTruthy()
    await page.press(page.q('section-change')!.querySelector('button')!)
    expect(calls.find(c => c.kind === 'actions')).toEqual({ kind: 'actions', name: 'withdraw', payload: { proposal: 'p-sec' } })
    expect(page.q('sent-note')?.textContent).toBe('Undone: your section is Silk again.')
    await page.done()
  })

  it('adding says it happens at once', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [job], proposals: [], applies_at_once: AT_ONCE }
    answers.subcategory_levels = { start: null, levels: [] }
    const page = await render('YourSections')
    await page.click('Add subcategories')
    expect(page.q('add-subcategories')?.textContent).toContain('Ticked subcategories are added at once. Mani Manager reviews them afterwards.')
    expect(page.button('Add')).toBeTruthy()
    await page.done()
  })

  it('what you have asked for says done, confirmed or undone, with the reason', () => {
    expect(outcome({ state: 'Not yet reviewed', waiting_for: 'Mani Manager' })).toEqual({ tone: 'positive', label: 'Done · Mani Manager will review it' })
    expect(outcome({ state: 'Confirmed', waiting_for: '' })).toEqual({ tone: 'positive', label: 'Done · confirmed' })
    expect(outcome({ state: 'Undone', waiting_for: '' })).toEqual({ tone: 'negative', label: 'Undone' })
  })

  it('the reviewer sees what is already done apart from what waits, and confirms', async () => {
    answers.approvals = { state: 'ok', proposals: [{ ...move, ...applied }, move] }
    answers.decide = { ...applied, state: 'Confirmed' }
    const page = await render('Approvals')
    expect(page.container.querySelector('h1')?.textContent).toBe('Waiting for you')
    expect(page.q('approvals-link')?.textContent).toContain('Waiting for you (2)')
    expect(page.q('to-review-heading')?.textContent).toBe('Already done · check and confirm, or undo')
    expect(page.q('to-approve-heading')?.textContent).toBe('Waiting for your approval · nothing changes until you approve')
    const [done] = page.container.querySelectorAll('[data-testid="approval"]')
    expect(done.textContent).toContain('Done on 05-Nov-2026 · not yet reviewed')
    expect(done.textContent).not.toContain('Move it elsewhere')
    await page.press([...done.querySelectorAll('button')].find(b => b.textContent === 'Confirm')!)
    expect(calls.find(c => c.kind === 'actions')).toEqual({ kind: 'actions', name: 'decide', payload: { proposal: 'p1', decision: 'confirm' } })
    expect(page.q('decision-note')?.textContent).toBe('Confirmed: Move Sarees.')
    await page.done()
  })

  it('Undo needs a reason, says what it does, and a refusal is said and the list refreshed', async () => {
    answers.approvals = { state: 'ok', proposals: [{ ...move, ...applied }] }
    answers.decide = { ...applied, state: 'Undone' }
    let page = await render('Approvals')
    await page.click('Undo…')
    expect(page.q('approval')?.textContent).toContain('Why are you undoing this?')
    expect(page.q('approval')?.textContent).toContain('It goes back to how it was before Asha Maker changed it. Asha Maker sees your reason.')
    await page.click('Undo it')
    expect(calls.filter(c => c.kind === 'actions')).toEqual([])
    await page.choose(page.q('approval')!.querySelector('input')!, 'Sarees stay in Silk')
    await page.click('Undo it')
    expect(calls.find(c => c.kind === 'actions')?.payload).toEqual({ proposal: 'p1', decision: 'undo', reason: 'Sarees stay in Silk' })
    expect(page.q('decision-note')?.textContent).toBe('Undone: Move Sarees. Asha Maker can see your reason.')
    await page.done()
    calls.length = 0
    answers.decide = new Error("Bala Holder changed it on 12-Nov-2026, after this applied, so it can't be undone. Put it right by hand instead.")
    page = await render('Approvals')
    await page.click('Undo…')
    await page.choose(page.q('approval')!.querySelector('input')!, 'Wrong')
    await page.click('Undo it')
    expect(page.q('decision-note')?.textContent).toBe("Asha Maker: Move Sarees. Bala Holder changed it on 12-Nov-2026, after this applied, so it can't be undone. Put it right by hand instead.")
    expect(calls.filter(c => c.name === 'approvals').length).toBeGreaterThan(1)
    await page.done()
  })

  it('an applied removal says where the subcategory is now', async () => {
    answers.approvals = { state: 'ok', proposals: [{ ...move, ...applied, kind: 'removal', from: { section: 'Ladies Wear', holder: 'Asha Maker' }, to: null, sections: [] }] }
    const page = await render('Approvals')
    expect(page.q('approval-removal')?.textContent).toBe('It is in no section at Lakeside now. If you undo it, it goes back to Ladies Wear.')
    await page.done()
  })

  it('a section change keeps its note though the job row changes underneath', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [job], proposals: [], applies_at_once: AT_ONCE }
    answers.propose_section = { ...applied, kind: 'section' }
    const page = await render('YourSections')
    // The read after the change answers with the job's new row.
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [{ ...job, id: 'new-job-row', section: { id: 'silk-row', name: 'Silk', floor: null },
      section_change: { id: 'p-sec', from: 'Ladies Wear', waiting_for: 'Mani Manager' } }], proposals: [], applies_at_once: AT_ONCE }
    await page.click('My section is wrong')
    await page.choose(page.q('pick-section')!.querySelector('select')!, 'silk-row')
    await page.click('Change it')
    expect(page.q('sent-note')?.textContent).toBe('Done: your section is changed. Mani Manager will review it.')
    await page.done()
  })

  it('a refused undo frees the card to try again', async () => {
    answers.approvals = { state: 'ok', proposals: [{ ...move, ...applied }] }
    answers.decide = new Error('It has since been put in Silk')
    const page = await render('Approvals')
    await page.click('Undo…')
    await page.choose(page.q('approval')!.querySelector('input')!, 'Wrong')
    await page.click('Undo it')
    expect(page.button('Undo it')?.disabled ?? false).toBe(false)
    expect(page.button('Undo it')?.getAttribute('aria-busy') ?? 'false').not.toBe('true')
    await page.done()
  })

  it('their own undo reads as taken back, not reviewed', async () => {
    answers.my_sections = { state: 'ok', name: 'Asha Maker', jobs: [job], applies_at_once: AT_ONCE, proposals: [
      { ...applied, state: 'Undone', taken_back: true, decided_on: '2026-11-06' },
      { ...applied, id: 'p2', state: 'Undone', taken_back: false, reason: 'Stays in Silk', decided_on: '2026-11-06' }] }
    const page = await render('YourSections')
    const [own, theirs] = page.container.querySelectorAll('[data-testid="your-proposal"]')
    expect(own.textContent).toContain('Taken back on 06-Nov-2026')
    expect(own.textContent).not.toContain('Reviewed')
    expect(theirs.textContent).toContain('Reviewed on 06-Nov-2026')
    await page.done()
  })
})
