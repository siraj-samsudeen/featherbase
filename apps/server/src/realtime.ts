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
}

/** Is this row within the principal's Data Scope — by its own Table AND by
 *  every Reference to a scoped Table? Decided by the same row read the API
 *  serves (getDoc applies every Data Scope rule), so realtime can never show
 *  a row the list would hide. */
export async function rowInScope(principal: string, table: string, rowId: string): Promise<boolean> {
  if (await isPrivileged(principal)) return true
  if (!(await getScopeMap(principal)).size) return true
  const { getDoc } = await import('./document')
  try {
    await getDoc(table, rowId, principal)
    return true
  } catch {
    return false
  }
}

/** A deleted row can no longer be read; its event goes to a scoped
 *  subscriber only when the Table's own scope names it and no Reference
 *  column points at a scoped Table (where membership is now unknowable). */
async function deletedVisible(scope: Map<string, Set<string>>, table: string, rowId: string): Promise<boolean> {
  const own = scope.get(table)
  if (own && !own.has(rowId)) return false
  const { getMeta } = await import('./meta')
  const meta = await getMeta(table).catch(() => null)
  if (!meta) return false
  return !meta.columns.some((c) => c.column_type === 'Reference' && c.reference_table && scope.has(c.reference_table))
}

/** May this subscriber see this list or row event? Decided against the
 *  principal's CURRENT Data Scope at delivery, so a scope granted or a
 *  Reference changed after subscribing is honoured at once. */
export async function eventVisibleTo(principal: string, msg: RealtimeEvent): Promise<boolean> {
  const payload = msg.payload as { table?: unknown; row_id?: unknown } | undefined
  if (payload?.row_id == null || typeof payload.table !== 'string') return true
  if (await isPrivileged(principal)) return true
  // Roles can change after subscribing (a service account's roles endpoint,
  // a person's form): read permission is rechecked too.
  if (!(await hasPermission(principal, payload.table, 'read'))) return false
  const scope = await getScopeMap(principal)
  if (!scope.size) return true
  const rowId = String(payload.row_id)
  return msg.event === 'deleted' ? deletedVisible(scope, payload.table, rowId) : rowInScope(principal, payload.table, rowId)
}

// Ordering caveat: list and row events are checked asynchronously per
// subscriber before sending, so two events for the same row published in
// quick succession can reach a client out of order. They carry no data —
// only {table, row_id} — and clients refetch on any of them, so the last
// refetch shows the current row either way.
async function deliverChecked(client: Client, msg: RealtimeEvent, data: string): Promise<void> {
  if ((await eventVisibleTo(client.user.row_id, msg)) && client.socket.readyState === client.socket.OPEN)
    client.socket.send(data)
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
    if (!c.channels.has(channel) || c.socket.readyState !== c.socket.OPEN) continue
    // person-rename R2: a list or row event reaches a subscriber only for a
    // row it can read now (own-Table and Reference scopes alike).
    if (channel.startsWith('list:') || channel.startsWith('row:')) void deliverChecked(c, msg, data).catch(() => {})
    else c.socket.send(data)
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
