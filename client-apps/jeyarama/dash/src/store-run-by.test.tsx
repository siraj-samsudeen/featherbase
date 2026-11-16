// #1245: who runs a store, under the area's title: its Store Manager and Cluster Managers, each a link.
// Rendered in a DOM (jsdom from apps/web). Made-up people.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

let teardown: () => void = () => {}
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
  // Every person's Dash page opens for this viewer, so each name is a link.
  ;(globalThis as Record<string, unknown>).fetch = async (_: string, init: RequestInit) => new Response(JSON.stringify({ result: (JSON.parse(String(init.body)).payload.refs as unknown[]).map(() => true) }), { status: 200 })
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())

type Managers = { store: { code: string; name: string }[]; cluster: { code: string; name: string }[] }

async function render(managers: Managers) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { StoreRunBy } = await import('./my-store-page')
  const { RecordPagesProvider } = await import('@featherbase/shop-floor')
  const { dashPageFor } = await import('./record-link')
  document.body.innerHTML = ''
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<RecordPagesProvider pageFor={dashPageFor}><StoreRunBy managers={managers} /></RecordPagesProvider>) })
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  const line = container.querySelector('[data-testid="store-run-by"]')!
  const links = [...line.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')])
  return { line, links, done: () => act(async () => root.unmount()) }
}

describe('who runs the store', () => {
  it('names its Store Manager and Cluster Managers, each a link to their Dash page', async () => {
    const { line, links, done } = await render({ store: [{ code: 'E1', name: 'Selvi Store' }], cluster: [{ code: 'E7', name: 'Kiran Cluster' }, { code: 'E8', name: 'Lata Cluster' }] })
    expect(line.textContent).toBe('Store Manager: Selvi Store · Cluster Manager: Kiran Cluster, Lata Cluster')
    expect(links).toEqual([['Selvi Store', '?view=coverage&employee=E1'], ['Kiran Cluster', '?view=coverage&employee=E7'], ['Lata Cluster', '?view=coverage&employee=E8']])
    await done()
  })

  it('says "No store manager" in grey when none is open, and leaves out an empty Cluster Manager', async () => {
    const { line, links, done } = await render({ store: [], cluster: [] })
    expect(line.textContent).toBe('No store manager')
    expect(line.querySelector('.text-ink-muted')?.textContent).toBe('No store manager')
    expect(links).toEqual([])
    await done()
  })

  it('names several Store Managers when several are open', async () => {
    const { line, done } = await render({ store: [{ code: 'E1', name: 'Nila Ending' }, { code: 'E2', name: 'Selvi Store' }], cluster: [] })
    expect(line.textContent).toBe('Store Manager: Nila Ending, Selvi Store')
    await done()
  })
})
