import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { credentialFromCookieHeader, resolveToken, type SessionUser } from './auth'
import { getRoles, getScopeMap, hasPermission, isPrivileged } from './permissions'

// RT-001/002/003: server-side realtime over WebSockets (the local equivalent
// of Supabase Realtime per the architecture invariants).
//
// Channels:
//   list:<Table>    — a row of that Table was created/updated/deleted
//   row:<Table>:<name> — that specific row changed
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
  /** person-rename R2: the subscriber's Data Scope, read when a list channel
   *  is subscribed; list events for rows outside it are not sent. */
  scope?: Map<string, Set<string>>
}

/** Is this row within the principal's Data Scope for its own Table? */
export async function rowInScope(principal: string, table: string, rowId: string): Promise<boolean> {
  if (await isPrivileged(principal)) return true
  const allowed = (await getScopeMap(principal)).get(table)
  return !allowed || allowed.has(rowId)
}

function listEventVisible(client: Client, channel: string, payload: unknown): boolean {
  if (!channel.startsWith('list:') || !client.scope) return true
  const allowed = client.scope.get(channel.slice(5))
  const rowId = (payload as { row_id?: unknown } | undefined)?.row_id
  return !allowed || rowId == null || allowed.has(String(rowId))
}

const clients = new Set<Client>()

// A user may only subscribe to:
//   user:<their own name>            — personal events
//   list:<Table> / row:<Table>:* — only Tables they can READ
// Any other channel request is rejected, preventing cross-user/cross-
// permission eavesdropping over the socket.
export async function canSubscribe(user: SessionUser, channel: string): Promise<boolean> {
  if (channel.startsWith('user:')) return channel === `user:${user.row_id}`
  // #101 Phase 4 (PR #104 review): the team-feed invalidation ping. Gated
  // like the feed endpoint itself (System Manager), and published with NO
  // payload — the data always flows through /api/activity_feed.
  if (channel === 'feed') return (await getRoles(user.row_id)).includes('System Manager')
  if (channel.startsWith('list:')) return hasPermission(user.row_id, channel.slice(5), 'read')
  if (channel.startsWith('row:')) {
    // row:<Table>:<name> — Table may itself contain ':' only in theory;
    // split on the first ':' after the prefix.
    const rest = channel.slice(4)
    const table = rest.slice(0, rest.lastIndexOf(':'))
    if (!table) return false
    // person-rename R2: a row outside the subscriber's Data Scope is not
    // theirs to watch, whichever kind of principal they are.
    return (await hasPermission(user.row_id, table, 'read')) && rowInScope(user.row_id, table, rest.slice(table.length + 1))
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
    if (c.channels.has(channel) && c.socket.readyState === c.socket.OPEN && listEventVisible(c, channel, payload))
      c.socket.send(data)
  }
}

// Convenience emitters for the row lifecycle.
export function publishDocEvent(
  table: string,
  rowId: string,
  event: 'created' | 'updated' | 'deleted',
): void {
  publish(`list:${table}`, event, { table, row_id: rowId })
  publish(`row:${table}:${rowId}`, event, { table, row_id: rowId })
  // #101 Phase 4: an invalidation ping for the (System Manager-only) team
  // feed. Deliberately payload-free — the subscriber may not have read
  // permission on this particular Table, and the feed data itself always
  // flows through the role-gated /api/activity_feed.
  publish('feed', 'changed')
}

export function publishUserEvent(user: string, event: string, payload?: unknown): void {
  publish(`user:${user}`, event, payload)
}

// Attach a WebSocket server to the shared HTTP server. Clients connect to
// /ws carrying the `sid` session cookie, then send {subscribe:[channels]} /
// {unsubscribe:[...]}. The server answers a subscribe frame with
// {channel:'system', event:'subscribed', payload:{channels:[...registered]}}.
export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', async (socket, req) => {
    try {
      // #173: the browser cannot set headers on a WebSocket, which is why this
      // was URL-borne. But the upgrade is an ordinary same-origin HTTP request,
      // so the HttpOnly `sid` cookie is already on it — and a `?token=` in the
      // socket URL lands in proxy logs like any other. A cross-site handshake
      // carries no SameSite=Lax cookie, so this closes that door too.
      const user = await resolveToken(credentialFromCookieHeader(req.headers.cookie))
      const client: Client = { socket, user, channels: new Set() }
      clients.add(client)
      // Personal channel is always subscribed.
      client.channels.add(`user:${user.row_id}`)
      socket.send(JSON.stringify({ channel: 'system', event: 'ready', payload: { user: user.row_id } }))

      socket.on('message', (raw) => {
        void (async () => {
          try {
            const msg = JSON.parse(String(raw)) as {
              subscribe?: string[]
              unsubscribe?: string[]
            }
            const registered: string[] = []
            for (const ch of msg.subscribe ?? []) {
              // Authorize each subscription; silently drop unpermitted ones.
              if (await canSubscribe(client.user, ch)) {
                if (ch.startsWith('list:') && !client.scope && !(await isPrivileged(client.user.row_id)))
                  client.scope = await getScopeMap(client.user.row_id)
                client.channels.add(ch)
                registered.push(ch)
              }
            }
            for (const ch of msg.unsubscribe ?? []) client.channels.delete(ch)
            // #224: acknowledge what was actually registered. A subscribe
            // frame is asynchronous — until the server has authorized and
            // recorded the channel, an event published on it is missed — so
            // without this the only way to know a subscription is live is to
            // guess with a sleep. Unpermitted channels are absent from the
            // ack rather than reported, keeping the existing "silently drop"
            // behaviour; a client that ignores the frame is unaffected.
            if (registered.length && socket.readyState === socket.OPEN)
              socket.send(
                JSON.stringify({
                  channel: 'system',
                  event: 'subscribed',
                  payload: { channels: registered },
                }),
              )
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
