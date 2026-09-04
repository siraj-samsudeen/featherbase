import { useEffect, useRef } from 'react'
import { getToken } from './api'

// RT-001/002/003: a single shared WebSocket to the server. Views subscribe
// to channels and receive events; the socket auto-reconnects.

export interface RealtimeEvent {
  channel: string
  event: string
  payload?: unknown
}

type Handler = (e: RealtimeEvent) => void

class RealtimeClient {
  private socket: WebSocket | null = null
  private handlers = new Set<Handler>()
  private channels = new Set<string>()
  // Channels the server has acknowledged registering. `channels` is what we
  // have *asked* for; this is what is actually live.
  private live = new Set<string>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // #224: mirror the live set onto the document element so it is observable
  // from outside the bundle. Nothing in the UI reads it — it exists so a
  // test can wait for "B is really subscribed" instead of sleeping a second
  // and hoping. Written as JSON because channel names contain both ':' and
  // spaces (`list:Sales Order`), so no separator is safe.
  private mirrorLiveChannels() {
    document.documentElement.dataset.realtimeChannels = JSON.stringify([...this.live])
  }

  private connect() {
    const token = getToken()
    if (!token) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    // #173: no token in the URL — the handshake is same-origin, so the
    // HttpOnly `sid` cookie rides along and is what the server authenticates.
    // getToken() above is only the "am I signed in?" gate.
    const socket = new WebSocket(`${proto}://${location.host}/ws`)
    this.socket = socket
    socket.onopen = () => {
      if (this.channels.size) socket.send(JSON.stringify({ subscribe: [...this.channels] }))
    }
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as RealtimeEvent
        if (msg.channel === 'system' && msg.event === 'subscribed') {
          for (const ch of (msg.payload as { channels?: string[] } | undefined)?.channels ?? [])
            this.live.add(ch)
          this.mirrorLiveChannels()
        }
        for (const h of this.handlers) h(msg)
      } catch {
        // ignore malformed frames
      }
    }
    socket.onclose = () => {
      this.socket = null
      // Nothing is live across a dropped socket; the channels are re-sent on
      // reconnect and re-acked from scratch.
      this.live.clear()
      this.mirrorLiveChannels()
      // Reconnect while we still have a token (i.e. logged in).
      if (getToken() && !this.reconnectTimer)
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          this.connect()
        }, 1000)
    }
    socket.onerror = () => socket.close()
  }

  private ensure() {
    if (!this.socket || this.socket.readyState > 1) this.connect()
  }

  subscribe(channels: string[], handler: Handler): () => void {
    this.handlers.add(handler)
    const added: string[] = []
    for (const ch of channels)
      if (!this.channels.has(ch)) {
        this.channels.add(ch)
        added.push(ch)
      }
    this.ensure()
    if (added.length && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ subscribe: added }))
    return () => {
      this.handlers.delete(handler)
    }
  }
}

export const realtime = new RealtimeClient()

// Subscribe to realtime channels for the lifetime of a component. The
// latest handler is always invoked (kept in a ref to dodge stale closures).
export function useRealtime(channels: string[], handler: (e: RealtimeEvent) => void): void {
  const key = channels.join('|')
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const unsub = realtime.subscribe(channels, (e) => ref.current(e))
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
