// #1218: the business roles pages, rendered in a DOM (jsdom from apps/web) with the platform's answers
// played by a stand-in `fetch`; the reads themselves are proved in business-roles-server.test.ts and
// platform-test/business-roles.test.ts. Made-up people and stores.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

type Call = { kind: string; name: string; payload: Record<string, unknown> }
const calls: Call[] = []
let answers: Record<string, unknown> = {}
let teardown: () => void = () => {}
let dom: { window: Record<string, unknown> & { close(): void } }

beforeAll(() => {
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => typeof dom }
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dash/?view=explain&person=sm' })
  const added: string[] = []
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue
    Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] })
    added.push(key)
  }
  for (const key of ['window', 'document', 'navigator', 'location', 'history', 'localStorage'])
    Object.defineProperty(globalThis, key, { configurable: true, get: () => (key === 'window' ? dom.window : dom.window[key]) })
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).fetch = async (url: string, init: RequestInit) => {
    const match = /app_(reads|actions)\/dash\/(.+)$/.exec(String(url))
    if (!match) return new Response('{}', { status: 404 })
    calls.push({ kind: match[1], name: match[2], payload: JSON.parse(String(init.body)).payload })
    return new Response(JSON.stringify({ result: answers[match[2]] ?? (/^(manages|holds)_/.test(match[2]) ? false : []) }), { status: 200 })
  }
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())

const SELVI = {
  person: 'sm', name: 'Selvi', who: { code: '3005', jobs: ['Store Manager · Lakeside'], staff: 'current' }, employee: '3005',
  roles: [{ role: 'r-sm', name: 'Store Manager', source: 'From HR title', from: 'Store Manager', area: { parts: [{ name: 'Lakeside', table: 'Site', id: 'LKS' }], stores: 1, subcategories: null },
    until: null, reason: null, hand: null, hand_updated_at: null }],
  unmapped: [], apps: [{ app: 'Dash', level: 'Reader', via: ['Store Manager'] }, { app: 'Tasker', level: 'Manager', via: ['Store Manager'] }],
  reports: [{ key: 'vs', name: 'Vendor Sales', why: ['Given to Store Manager, for Lakeside'] }],
  today: { opens: true, reports: 1, stores: 1 }, next: { opens: true }, decisions: [], choices: [{ id: 'r-sm', name: 'Store Manager' }, { id: 'r-tl', name: 'Team Leader' }],
}
beforeEach(() => { calls.length = 0; document.body.innerHTML = ''; answers = { explain_person: SELVI, give_role: { id: 'h1' } } })

async function render(element: 'explain' | 'roles' | 'changes') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const pages = await import('./roles-page')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  const Page = element === 'explain' ? pages.ExplainPersonPage : element === 'roles' ? pages.BusinessRolesPage : pages.AccessChangesPage
  await act(async () => { createRoot(container).render(<Page />) })
  await settle()
  const all = (testid: string) => [...container.querySelectorAll(`[data-testid="${testid}"]`)]
  const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }); await settle() }
  const set = async (element: HTMLInputElement | HTMLSelectElement, value: string) => {
    await act(async () => {
      const proto = element instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
      element.dispatchEvent(new window.Event(element instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    })
    await settle()
  }
  return { container, all, click, set }
}

describe('Explain A Person', () => {
  it('shows a role with its area and source chip', async () => {
    const { all } = await render('explain')
    expect(all('explain-role').map(line => [line.querySelector('[data-testid="role-area"]')!.textContent, line.querySelector('[data-testid="source-chip"]')!.textContent]))
      .toEqual([['Lakeside', 'From HR title']])
  })

  it('shows each report with a why line', async () => {
    const { all } = await render('explain')
    expect(all('why-line').map(line => line.textContent)).toEqual(['Why: Given to Store Manager, for Lakeside'])
  })

  it('also gives a role with an end date, then reads the person again', async () => {
    const { all, click, set } = await render('explain')
    await click(all('also-give-button')[0])
    await set(all('hand-role')[0] as HTMLSelectElement, 'r-tl')
    await set(all('hand-ends')[0] as HTMLInputElement, '2027-03-31')
    await click(all('hand-save')[0])
    expect([calls.find(c => c.name === 'give_role')?.payload, calls.filter(c => c.name === 'explain_person').length])
      .toEqual([{ person: 'sm', change: 'Also give', role: 'r-tl', ends_on: '2027-03-31', reason: '' }, 2])
  })

  it('says whether they are an Employee, a Former Employee or External', async () => {
    const { all } = await render('explain')
    expect(all('staff-badge').map(b => b.textContent)).toEqual(['Employee'])
  })
})

describe('Business Roles', () => {
  it('reads a permission as a sentence with its reach, and lists titles not mapped yet first', async () => {
    answers = { business_roles: {
      roles: [{ id: 'r-sm', name: 'Store Manager', description: 'Runs a store.', by_hand_only: false, permissions: [{ app: 'Dash', level: 'Manager', reach: 'Area', sentence: 'Store Managers can Edit Sections in their Area' }] }],
      titles: [{ title: 'Operations Executive', role: null, role_name: null, people: 3, falls_back_to: 'Store Manager' }, { title: 'Store Manager', role: 'r-sm', role_name: 'Store Manager', people: 4 }],
    } }
    const { all, click } = await render('roles')
    await click(all('role-open')[0])
    expect([all('permission-line').map(l => l.textContent), all('unmapped-line').map(l => l.querySelector('.font-medium')!.textContent)])
      .toEqual([['Dash · ManagerStore Managers can Edit Sections in their AreaArea'], ['Operations Executive']])
  })
})

describe('Who Would Gain Or Lose Access', () => {
  it('lists only people with a difference, with a count per kind', async () => {
    answers = { access_changes: { people: 3, groups: [
      { kind: 'loses_dash', people: [{ person: 'st', name: 'Siva', who: null, kind: 'loses_dash', roles: ['Staff'], stores_gained: [], stores_lost: [], stores_changed: [], gained: [], lost: [], decisions: [] }] },
      { kind: 'gains_dash', people: [] }, { kind: 'stores', people: [] }, { kind: 'reports', people: [] }, { kind: 'decision', people: [] }] } }
    const { all } = await render('changes')
    expect([all('changed-name').map(a => [a.textContent, a.getAttribute('href')]), all('group-loses_dash-count')[0].textContent])
      .toEqual([[['Siva', '?view=explain&person=st']], '1'])
  })
})
