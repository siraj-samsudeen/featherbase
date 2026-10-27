// Realtime for a component test. The page's realtime client opens a
// WebSocket; jsdom has the class but no server behind it. This stand-in
// carries the IN-PROCESS server's real events (server/src/realtime onEvent)
// to the page for the channels the page subscribed to, and acknowledges the
// subscription the way the server does. Only the transport is stood in: what
// arrives is what the server published. Install before rendering; undone by
// `vi.unstubAllGlobals()` and the returned stop().
import { vi } from 'vitest'
import { onEvent } from 'server/src/realtime'

export function bridgeRealtime(): () => void {
  const sockets = new Set<BridgeSocket>()
  class BridgeSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readyState = BridgeSocket.CONNECTING
    channels = new Set<string>()
    onopen: (() => void) | null = null
    onmessage: ((ev: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(_url: string) {
      sockets.add(this)
      queueMicrotask(() => {
        this.readyState = BridgeSocket.OPEN
        this.onopen?.()
      })
    }
    send(frame: string) {
      const { subscribe, unsubscribe } = JSON.parse(frame) as { subscribe?: string[]; unsubscribe?: string[] }
      for (const ch of unsubscribe ?? []) this.channels.delete(ch)
      for (const ch of subscribe ?? []) this.channels.add(ch)
      const channels = subscribe
      if (channels)
        this.onmessage?.({ data: JSON.stringify({ channel: 'system', event: 'subscribed', payload: { channels } }) })
    }
    close() {
      this.readyState = BridgeSocket.CLOSED
      sockets.delete(this)
    }
  }
  vi.stubGlobal('WebSocket', BridgeSocket)
  return onEvent((e) => {
    for (const s of sockets) if (s.channels.has(e.channel)) s.onmessage?.({ data: JSON.stringify(e) })
  })
}
