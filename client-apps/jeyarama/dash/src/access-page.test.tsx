// The Report access page (#1216): people with the same name told apart by code, job and site,
// in three layouts behind a toggle. Rendered in a DOM (jsdom from apps/web), with the platform's
// answers played by a stand-in `fetch`; the reads themselves are proved on the real platform in
// platform-test/report-access.test.ts. Made-up people and stores.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { personDetail, personWithCode } from './person-identity'

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
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dash/?view=access' })
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
    const [, kind, name] = /app_(reads|actions)\/dash\/(.+)$/.exec(String(url))!
    const body = JSON.parse(String(init.body))
    calls.push({ kind: kind as Call['kind'], name, payload: body.payload })
    return new Response(JSON.stringify({ result: answers[name] ?? [] }), { status: 200 })
  }
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())
beforeEach(() => { calls.length = 0; document.body.innerHTML = ''; localStorage.clear()
  answers = { access_page: PAGE, person_search: FOUND, give_report: { id: 'new' } } })

const LEADER = { code: 'E1001', jobs: ['Team Leader · Lakeside'], staff: 'current' }
const OFFICE = { code: 'E1002', jobs: ['Head office staff · Head office'], staff: 'current' }
const FOUND = [
  { person: 'k1', name: 'Kumar', ...LEADER },
  { person: 'k2', name: 'Kumar', ...OFFICE },
  { person: 'k3', name: 'Kumar', code: 'E1003', jobs: [], staff: 'current' },
]
const PAGE = {
  reports: [{ key: 'sales', name: 'Sales versus target' }], bundles: [], roles: [], jobs: ['Team Leader'],
  rows: [
    { id: 'a1', updated_at: 'u', gives: { kind: 'Report', name: 'Sales versus target' }, to: { kind: 'Person', name: 'Kumar', who: LEADER }, given_by: 'Meera', given_on: '2026-11-07' },
    { id: 'a2', updated_at: 'u', gives: { kind: 'Report', name: 'Sales versus target' }, to: { kind: 'Person', name: 'Kumar Old', who: { code: 'E0900', jobs: [], staff: 'left' } }, given_by: 'Meera', given_on: '' },
    { id: 'a3', updated_at: 'u', gives: { kind: 'Report', name: 'Sales versus target' }, to: { kind: 'Person', name: 'Report robot', who: { code: null, jobs: [], staff: 'none' } }, given_by: 'Meera', given_on: '' },
    { id: 'a4', updated_at: 'u', gives: { kind: 'Report', name: 'Sales versus target' }, to: { kind: 'Job', name: 'Team Leader' }, given_by: 'Meera', given_on: '' },
  ],
  waiting: [{ person: 'k2', name: 'Kumar', asked_on: '2026-11-07', who: OFFICE }],
}

async function render() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ReportAccess } = await import('./access-page')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  await act(async () => { root.render(<ReportAccess />) })
  await settle()
  const all = (testid: string) => [...container.querySelectorAll(`[data-testid="${testid}"]`)]
  const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }); await settle() }
  const button = (label: string, within: Element = container) => [...within.querySelectorAll('button')].find(b => b.textContent === label)!
  const type = async (element: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await act(async () => { await new Promise(done => setTimeout(done, 300)) })
    await settle()
  }
  const choose = async (element: HTMLSelectElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
  }
  return { container, all, click, button, type, choose, done: () => act(async () => root.unmount()) }
}

describe('who a person is, in words', () => {
  it('gives the code and the jobs held today, or says plainly why there are none', () => {
    expect(personDetail({ code: 'E1001', jobs: ['Team Leader · Lakeside'], staff: 'current' })).toBe('E1001 · Team Leader · Lakeside')
    expect(personDetail({ code: 'E2001', jobs: ['Floor Manager · Lakeside', 'Store Manager · Hilltop'], staff: 'current' })).toBe('E2001 · Floor Manager · Lakeside, Store Manager · Hilltop')
    expect(personDetail({ code: 'E1003', jobs: [], staff: 'current' })).toBe('E1003 · No current job')
    expect(personDetail({ code: null, jobs: ['Staff · Lakeside'], staff: 'current' })).toBe('Staff · Lakeside')
    expect(personDetail({ code: 'E0900', jobs: [], staff: 'left' })).toBe('E0900 · Left')
    expect(personDetail({ code: null, jobs: [], staff: 'none' })).toBe('Not on the staff list')
    expect(personDetail(undefined)).toBe('')
    expect([personWithCode('Kumar', LEADER as never), personWithCode('Report robot', { code: null, jobs: [], staff: 'none' })]).toEqual(['Kumar (E1001)', 'Report robot'])
  })
})

describe('the person picker (#1216)', () => {
  it('shows each same-named person with their code, job and site, and keeps it once chosen', async () => {
    const page = await render()
    const [search] = page.all('person-search') as HTMLInputElement[]
    await page.type(search, 'kumar')
    expect(page.all('person-result').map(result => result.textContent)).toEqual([
      'KumarE1001 · Team Leader · LakesidePerson', 'KumarE1002 · Head office staff · Head officePerson', 'KumarE1003 · No current jobPerson',
    ])
    await page.click(page.all('person-result')[1])
    expect(page.all('person-chosen')[0].textContent).toContain('KumarE1002 · Head office staff · Head office')
    await page.choose(page.all('give-what')[0] as HTMLSelectElement, 'report:sales')
    await page.click(page.all('give-button')[0])
    expect(calls.filter(call => call.kind === 'actions')).toEqual([{ kind: 'actions', name: 'give_report', payload: { report: 'sales', person: 'k2' } }])
    expect(page.all('give-done')[0].textContent).toBe('Sales versus target is given to Kumar (E1002).')
    await page.done()
  })
})

describe('who has what, and who is waiting (#1216)', () => {
  it('names each person with who they are; a job row is unchanged', async () => {
    const page = await render()
    const to = page.all('access-row').map(row => row.querySelector('[data-testid="person-name"]')?.textContent ?? null)
    expect(to).toEqual(['KumarE1001 · Team Leader · Lakeside', 'Kumar OldE0900 · Left', 'Report robotNot on the staff list', null])
    expect(page.all('waiting-person')[0].textContent).toBe('KumarE1002 · Head office staff · Head office · asked on 07-Nov-2026')
    await page.click(page.all('remove')[0])
    expect(page.all('remove-confirm')[0].textContent).toContain('Remove Sales versus target from Kumar (E1001)?')
    expect(page.container.textContent).not.toContain('@')
    await page.done()
  })
})

describe('three layouts behind a toggle (#1216)', () => {
  it('starts on two lines, switches everywhere at once, and remembers the choice', async () => {
    const page = await render()
    const layout = () => [...new Set(page.all('person-name').map(name => name.getAttribute('data-layout')))]
    expect(layout()).toEqual(['two-lines'])
    expect(page.all('person-detail')[0].className).toContain('block')
    await page.click(page.button('One line'))
    expect(layout()).toEqual(['one-line'])
    expect(page.all('person-name')[0].textContent).toBe('Kumar · E1001 · Team Leader · Lakeside')
    await page.click(page.button('Code first'))
    expect(layout()).toEqual(['code-first'])
    expect(page.all('person-code').map(code => code.textContent)).toEqual(['E1001', 'E0900', 'E1002'])
    expect(page.all('person-name').map(name => name.textContent)).toEqual(['E1001KumarTeam Leader · Lakeside', 'E0900Kumar OldLeft', 'Report robotNot on the staff list', 'E1002KumarHead office staff · Head office'])
    await page.done()
    const again = await render()
    expect([...new Set(again.all('person-name').map(name => name.getAttribute('data-layout')))]).toEqual(['code-first'])
    await again.done()
  })
})
