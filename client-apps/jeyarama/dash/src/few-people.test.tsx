// #1223: a "+N more" list of Team Leaders closes the way a menu does: on Escape, and on a click outside it.
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
  // No one may open these people's pages here: every link is plain text, which this test does not read.
  ;(globalThis as Record<string, unknown>).fetch = async () => new Response(JSON.stringify({ result: [] }), { status: 200 })
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())

const person = (code: string) => ({ code, name: `Person ${code}` })

async function render() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { FewPeople } = await import('./my-store-page')
  document.body.innerHTML = '<p id="outside">Elsewhere on the page</p>'
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<><FewPeople people={['E1', 'E2', 'E3', 'E4'].map(person)} /><FewPeople people={['E5', 'E6', 'E7'].map(person)} /></>) })
  const lists = [...container.querySelectorAll('details')] as HTMLDetailsElement[]
  return { act, lists, done: () => act(async () => root.unmount()) }
}

describe('a "+N more" list', () => {
  it('closes on Escape and gives focus back to its "+N more"', async () => {
    const { act, lists: [list], done } = await render()
    list.open = true
    await act(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(list.open).toBe(false)
    expect(document.activeElement).toBe(list.querySelector('summary'))
    await done()
  })

  it('closes on a click outside it, and stays open on a click inside it', async () => {
    const { act, lists: [list, other], done } = await render()
    list.open = true
    await act(async () => { list.querySelector('div')!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
    expect(list.open).toBe(true)
    await act(async () => { document.getElementById('outside')!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
    expect(list.open).toBe(false)
    expect(other.open).toBe(false)
    await done()
  })

  it('leaves a closed list and other keys alone', async () => {
    const { act, lists: [list], done } = await render()
    list.open = true
    await act(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true })) })
    expect(list.open).toBe(true)
    await done()
  })
})
