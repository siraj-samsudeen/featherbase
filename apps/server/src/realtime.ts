import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { resolveToken, type SessionUser } from './auth'
import { hasPermission } from './permissions'

// RT-001/002/003: server-side realtime over WebSockets (the local equivalent
// of Supabase Realtime per the architecture invariants).
//
// Channels:
//   list:<DocType>    — a doc of that type was created/updated/deleted
//   doc:<DocType>:<name> — that specific document changed
//   user:<name>       — a personal event (e.g. a new notification)
//
// The lifecycle emits events via publish(); connected clients receive the
// events for channels they subscribed to. Events also flow through an
// in-process EventBus so tests (and future SSR) can observe them without a
// socket.

export interface RealtimeEvent {
  channel: string
  event: string
  payload?: unknown
}

type Listener = (e: RealtimeEvent) => void
const listeners = new Set<Listener>()

// In-process subscription (used by tests and any server-side consumer).
export function onEvent(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

interface Client {
  socket: WebSocket
  user: SessionUser
  channels: Set<string>
}

const clients = new Set<Client>()

// A user may only subscribe to:
//   user:<their own name>            — personal events
//   list:<DocType> / doc:<DocType>:* — only DocTypes they can READ
// Any other channel request is rejected, preventing cross-user/cross-
// permission eavesdropping over the socket.
export async function canSubscribe(user: SessionUser, channel: string): Promise<boolean> {
  if (channel.startsWith('user:')) return channel === `user:${user.name}`
  if (channel.startsWith('list:')) return hasPermission(user.name, channel.slice(5), 'read')
  if (channel.startsWith('doc:')) {
    // doc:<DocType>:<name> — DocType may itself contain ':' only in theory;
    // split on the first ':' after the prefix.
    const rest = channel.slice(4)
    const doctype = rest.slice(0, rest.lastIndexOf(':'))
    if (!doctype) return false
    return hasPermission(user.name, doctype, 'read')
  }
  return false
}

export function publish(channel: string, event: string, payload?: unknown): void {
  const msg: RealtimeEvent = { channel, event, payload }
  for (const l of listeners) {
    try {
      l(msg)
    } catch {
      // a listener error must not stop delivery
    }
  }
  const data = JSON.stringify(msg)
  for (const c of clients) {
    if (c.channels.has(channel) && c.socket.readyState === c.socket.OPEN) c.socket.send(data)
  }
}

// Convenience emitters for the document lifecycle.
export function publishDocEvent(
  doctype: string,
  name: string,
  event: 'created' | 'updated' | 'deleted',
): void {
  publish(`list:${doctype}`, event, { doctype, name })
  publish(`doc:${doctype}:${name}`, event, { doctype, name })
}

export function publishUserEvent(user: string, event: string, payload?: unknown): void {
  publish(`user:${user}`, event, payload)
}

// Attach a WebSocket server to the shared HTTP server. Clients connect to
// /ws?token=<jwt>, then send {subscribe:[channels]} / {unsubscribe:[...]}.
export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', async (socket, req) => {
    try {
      const url = new URL(req.url ?? '', 'http://localhost')
      const token = url.searchParams.get('token')
      const user = await resolveToken(token ? `Bearer ${token}` : undefined)
      const client: Client = { socket, user, channels: new Set() }
      clients.add(client)
      // Personal channel is always subscribed.
      client.channels.add(`user:${user.name}`)
      socket.send(JSON.stringify({ channel: 'system', event: 'ready', payload: { user: user.name } }))

      socket.on('message', (raw) => {
        void (async () => {
          try {
            const msg = JSON.parse(String(raw)) as {
              subscribe?: string[]
              unsubscribe?: string[]
            }
            for (const ch of msg.subscribe ?? []) {
              // Authorize each subscription; silently drop unpermitted ones.
              if (await canSubscribe(client.user, ch)) client.channels.add(ch)
            }
            for (const ch of msg.unsubscribe ?? []) client.channels.delete(ch)
          } catch {
            // ignore malformed frames
          }
        })()
      })
      socket.on('close', () => clients.delete(client))
      socket.on('error', () => clients.delete(client))
    } catch {
      socket.close(4001, 'unauthorized')
    }
  })
}
