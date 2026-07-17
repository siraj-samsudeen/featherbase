import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// The Desk opens a realtime WebSocket on mount. In jsdom that would attempt
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

afterEach(() => {
  cleanup()
  localStorage.clear()
})
