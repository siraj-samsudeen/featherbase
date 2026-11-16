// #1240: "Report an issue" closed mid-Send and opened again. Rendered in a DOM (jsdom from
// apps/web); Tickets is played by a stand-in `fetch` that keeps tickets by idempotency key, as the
// platform does (it replays a key it has seen). Tickets' own replay is proved on the real platform
// in apps/server/test/tickets-report-feedback.test.ts. Made-up people and stores.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

const CONTEXT = { state: 'ok', report: { key: 'sales', name: 'Sales versus target' }, person: 'Tara Leader',
  jobs: ['Team Leader job assignment'], reach: [{ store: '9901', name: 'Lakeside', whole: false, sections: ['Sarees'], subcategories: ['010101001'] }] }

/** Tickets as the platform runs it: one ticket per idempotency key, a repeated key answered with its ticket. */
let byKey: Map<string, { row_id: string; problem: string; about: string }>
/** What happens to the next create: answered, held until released, or committed with its answer lost. */
let nextCreate: 'answer' | 'hold' | 'lose'
let release: () => void = () => {}
let teardown: () => void = () => {}

function create(body: { idempotencyKey: string; payload: { details: { problem: string; about?: string } } }) {
  if (!byKey.has(body.idempotencyKey))
    byKey.set(body.idempotencyKey, { row_id: `FT-0000${byKey.size + 1}`, problem: body.payload.details.problem, about: body.payload.details.about ?? '' })
  const ticket = byKey.get(body.idempotencyKey)!
  const answer = () => new Response(JSON.stringify({ result: { ticket: { row_id: ticket.row_id, title: 't', ticket_state: 'New' } } }), { status: 200 })
  const mode = nextCreate
  nextCreate = 'answer'
  if (mode === 'lose') return Promise.reject(new TypeError('Failed to fetch'))
  if (mode === 'hold') return new Promise<Response>(done => { release = () => done(answer()) })
  return Promise.resolve(answer())
}

beforeAll(() => {
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Record<string, unknown> & { close(): void } } }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dash/?report=sales&store=9901' })
  const added: string[] = []
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue
    Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] })
    added.push(key)
  }
  for (const key of ['window', 'document', 'navigator', 'location', 'history', 'localStorage'])
    Object.defineProperty(globalThis, key, { configurable: true, get: () => (key === 'window' ? dom.window : dom.window[key]) })
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).fetch = async (url: string, init?: RequestInit) => {
    const path = String(url)
    const ok = (result: unknown) => new Response(JSON.stringify({ result }), { status: 200 })
    if (path === '/api/runtime_app_versions') return new Response(JSON.stringify(['dash@0.13.12', 'tickets@0.2.17']), { status: 200 })
    if (path.endsWith('/app_reads/dash/feedback_context')) return ok(CONTEXT)
    if (path.endsWith('/app_reads/tickets/about_report')) {
      const tickets = [...byKey.values()].reverse().map(t => ({ row_id: t.row_id, title: 't', ticket_state: 'New', problem: t.problem, about: t.about }))
      return ok({ answer: { tickets, count: tickets.length } })
    }
    if (path.endsWith('/app_actions/tickets/create')) return create(JSON.parse(String(init!.body)))
    throw new Error(`unexpected ${path}`)
  }
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())
beforeEach(() => { byKey = new Map(); nextCreate = 'answer'; document.body.innerHTML = '' })

async function render(props: { store?: string; chosen?: string; hidden?: boolean } = {}) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ReportIssue } = await import('./report-issue-panel')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })
  await act(async () => { root.render(<ReportIssue reportKey="sales" reportName="Sales versus target" store={props.store ?? '9901'} month="this" chosen={props.chosen ?? '9901|this'} />) })
  await settle()
  const one = (testid: string) => container.querySelector(`[data-testid="${testid}"]`)
  const all = (testid: string) => [...container.querySelectorAll(`[data-testid="${testid}"]`)]
  const click = async (element: Element | null) => {
    expect(element).not.toBeNull()
    await act(async () => { element!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await settle()
  }
  const type = async (element: Element | null, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(element, value)
      element!.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await settle()
  }
  const open = () => click(one('report-issue'))
  const close = () => click(container.querySelector('button[aria-label="Close"]'))
  const send = () => click(one('issue-send'))
  const pick = (label: string) => click(all('issue-pick').find(b => b.textContent === label)!)
  const rerender = (next: { store?: string; chosen?: string; hidden?: boolean }) => act(async () => {
    root.render(<ReportIssue reportKey="sales" reportName="Sales versus target" store={next.store} month="this" chosen={next.chosen ?? '9901|this'} hidden={next.hidden} />)
  })
  return { rerender, container, one, all, open, close, send, pick, type, settle, act, done: () => act(async () => root.unmount()) }
}

describe('Report an issue, closed mid-Send', () => {
  it('sent again after a lost answer, raises exactly one ticket: the reopened panel resends the same submission', async () => {
    const page = await render()
    await page.open()
    await page.pick('Stock missing')
    await page.type(page.one('issue-about'), 'Soft silk 6 yards')
    nextCreate = 'lose'
    await page.send()
    expect(page.one('issue-error')).not.toBeNull()
    expect(byKey.size).toBe(1)
    await page.close()
    expect(page.one('issue-panel')).toBeNull()
    await page.open()
    // The unanswered submission comes back as it was, and Send sends it again as itself.
    expect((page.one('issue-about') as HTMLInputElement).value).toBe('Soft silk 6 yards')
    expect(page.all('issue-pick').find(b => b.getAttribute('aria-checked') === 'true')?.textContent).toBe('Stock missing')
    await page.send()
    expect(page.one('issue-sent')?.textContent).toContain('FT-00001')
    expect(byKey.size).toBe(1)
    await page.done()
  })

  it('reopened before its answer, shows it still going and then its ticket, and cannot be sent a second time', async () => {
    const page = await render()
    await page.open()
    await page.pick('Item ran out')
    nextCreate = 'hold'
    await page.send()
    await page.close()
    await page.open()
    expect((page.one('issue-send') as HTMLButtonElement).disabled).toBe(true)
    await page.send()
    await page.act(async () => { release() })
    await page.settle()
    expect(page.one('issue-sent')?.textContent).toContain('FT-00001')
    expect(byKey.size).toBe(1)
    await page.done()
  })

  it('kept when the page moves from its cached view to the Dive under it, so a retry is still the same ticket', async () => {
    const page = await render({ store: '9901', chosen: '|this' })
    await page.open()
    await page.pick('Data looks wrong')
    nextCreate = 'lose'
    await page.send()
    // The Dive takes over from the cached view: the store on show is now the Dive's, not the page's.
    await page.rerender({ store: undefined, chosen: '|this' })
    await page.settle()
    await page.send()
    expect(page.one('issue-sent')?.textContent).toContain('FT-00001')
    expect(byKey.size).toBe(1)
    await page.done()
  })

  it('kept while the page shows no report for a moment (the Dive late, then ready), so a retry is still the same ticket', async () => {
    const page = await render()
    await page.open()
    await page.pick('Stock missing')
    nextCreate = 'lose'
    await page.send()
    await page.rerender({ store: '9901', hidden: true })
    await page.settle()
    expect(page.one('report-issue')).toBeNull()
    await page.rerender({ store: '9901' })
    await page.settle()
    await page.open()
    await page.send()
    expect(page.one('issue-sent')?.textContent).toContain('FT-00001')
    expect(byKey.size).toBe(1)
    await page.done()
  })

  it('answered after it was closed, raises one ticket, which the reopened panel and the button show as open', async () => {
    const page = await render()
    await page.open()
    await page.pick('Target too high or too low')
    nextCreate = 'hold'
    await page.send()
    await page.close()
    await page.act(async () => { release() })
    await page.settle()
    expect(byKey.size).toBe(1)
    expect(page.one('report-issue')?.textContent).toContain('1 open')
    await page.open()
    expect(page.one('issue-mine')?.textContent).toContain('FT-00001')
    // The answered submission is done with: the form is fresh, and a new Send is a new ticket.
    expect(page.all('issue-pick').some(b => b.getAttribute('aria-checked') === 'true')).toBe(false)
    await page.done()
  })
})
