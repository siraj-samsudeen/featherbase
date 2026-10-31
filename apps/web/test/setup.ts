import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// #527: a first render warms the in-process server and Vite's transform cache,
// which on a busy machine (CI shards, parallel agents) takes longer than
// Testing Library's 1s default. A missing element still fails, after 5s.
configure({ asyncUtilTimeout: 5000 })

// The Admin opens a realtime WebSocket on mount. In jsdom that would attempt
// a real TCP connection (refused → close → 1s reconnect loop). This stub
// stays CONNECTING forever: the client neither errors nor reconnects, and
// never sends (it only sends when OPEN).
class SilentWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = SilentWebSocket.CONNECTING
  onopen: unknown = null
  onmessage: unknown = null
  onclose: unknown = null
  onerror: unknown = null
  constructor(_url: string) {}
  send(_data: string) {}
  close() {
    this.readyState = SilentWebSocket.CLOSED
  }
  addEventListener() {}
  removeEventListener() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).WebSocket = SilentWebSocket

// jsdom reports what it cannot do (a full-page load: "Not implemented:
// navigation") as a jsdomError. Under Vitest 5 its console is not the one a
// test spies on, so tests that spot a page load through console.error saw
// nothing. Send each report to whatever console.error is at that moment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsdomConsole = (window as any)._settings.virtualConsole as { removeAllListeners(e: string): void; on(e: string, f: (err: Error) => void): void }
jsdomConsole.removeAllListeners('jsdomError')
jsdomConsole.on('jsdomError', (err) => console.error(err))

// jsdom has no matchMedia, and Vitest 4+ refuses vi.spyOn on a missing
// property. This one never matches, which is what the app reads from an
// absent matchMedia (useMediaQuery, theme-paint), so a phone-width test can
// spy on it and vi.restoreAllMocks() returns it here.
window.matchMedia = (query: string) =>
  ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as MediaQueryList

afterEach(() => {
  cleanup()
  localStorage.clear()
  // A spy one test leaves on would be the next test's "real" function, and
  // Vitest 4+ re-spies a spy in place instead of wrapping it, so a pass-through
  // spy (`real = globalThis.fetch; spyOn(...)(() => real(...))`) calls itself.
  vi.restoreAllMocks()
})
