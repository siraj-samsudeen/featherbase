// #950 checklist 11: the page takes the theme the person chose in the shared top bar, which the
// bar writes on <html> as data-featherbase-theme and announces with featherbase:theme-change.
// jsdom from this repository's apps/web, as app.test.tsx uses it.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let teardown: () => void = () => {}
beforeAll(() => {
  const require = createRequire(resolve(import.meta.dirname, '../../../../apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis } }
  const dom = new JSDOM('<!doctype html><html data-featherbase-theme="dark"><body></body></html>')
  const keys = ['window', 'document', 'CustomEvent'] as const
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  teardown = () => { for (const key of keys) Reflect.deleteProperty(globalThis, key); dom.window.close() }
})
afterAll(() => teardown())

describe("the page follows the bar's theme", () => {
  it('paints the theme the bar already painted, then each change the bar announces', async () => {
    const { followBarTheme } = await import('./theme')
    followBarTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
    window.dispatchEvent(new CustomEvent('featherbase:theme-change', { detail: { theme: 'light' } }))
    expect(document.documentElement.dataset.theme).toBe('light')
    window.dispatchEvent(new CustomEvent('featherbase:theme-change', { detail: { theme: 'dark' } }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
