// A DOM for tests that render React (jsdom from this repository's apps/web: no
// test dependency of the app's own). Returns what closes it.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

export function openDom(url = 'http://localhost/dash/'): () => void {
  // This repository's root (client-apps/jeyarama/dash/src → four levels up), with `pnpm install` run.
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Record<string, unknown> & { close(): void } } }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })
  const added: string[] = []
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue
    Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] })
    added.push(key)
  }
  const replaced = ['window', 'document', 'navigator', 'location', 'history'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key] of replaced)
    Object.defineProperty(globalThis, key, { configurable: true, get: () => (key === 'window' ? dom.window : dom.window[key]) })
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  return () => {
    for (const key of added) delete (globalThis as Record<string, unknown>)[key]
    for (const [key, descriptor] of replaced) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete (globalThis as Record<string, unknown>)[key]
    }
    dom.window.close()
  }
}
