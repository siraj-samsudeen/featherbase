import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { credentialFromCookieHeader, endedSessionIds, resolveToken, type SessionUser } from './auth'
import { getRoles, getScopeMap, hasPermission, isPrivileged, requiresScope, tableScope } from './permissions'
import { REALTIME_MAX_FRAME_BYTES } from 'shared'
import { needsMandatoryRowRead } from './mandatory-access'
import { activeViewAs, whileViewAsHolds } from './view-as'
import { sql } from './db'

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
  /** Whose reads the socket follows: the signed-in person, or whom they view as (#1222). */
  user: SessionUser
  /** #1222: who signed in, whose session ends it. */
  owner: SessionUser
  /** #1222: the person it was opened viewing as, if any. */
  viewing?: string
  channels: Set<string>
}

/** Is this row within the principal's Data Scope — by its own Table AND by
 *  every Reference to a scoped Table? Decided by the same row read the API
 *  serves (getDoc applies every Data Scope rule), so realtime can never show
 *  a row the list would hide. */
async function rowInScope(principal: string, table: string, rowId: string): Promise<boolean> {
  const protectedRow = await needsMandatoryRowRead(table)
  if (!protectedRow && await isPrivileged(principal)) return true
  if (!protectedRow && !(await getScopeMap(principal)).size && !(await scopeRequired(table)) && !(await placeScoped(table))) return true
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
  const { getMeta } = await import('./meta')
  // Only reached once the principal may read the Table, so it exists.
  const meta = await getMeta(table)
  const narrowed = tableScope(meta, scope)
  if (!narrowed) return true
  if (narrowed.none || (narrowed.own && !narrowed.own.has(rowId))) return false
  return !narrowed.refs.length
}

/** #1454: a Table read only within each person's places. */
async function placeScoped(table: string): Promise<boolean> {
  const { placeScopeOf } = await import('./place-scope')
  return (await placeScopeOf(table)) !== null
}

/** #246: a Table that refuses everyone without a Data Scope on its dimensions. */
async function scopeRequired(table: string): Promise<boolean> {
  const { getMeta } = await import('./meta')
  // Only reached once the principal may read the Table, so it exists.
  return requiresScope(await getMeta(table))
}

/** May this subscriber see this list or row event? Decided against the
 *  principal's CURRENT Data Scope at delivery, so a scope granted or a
 *  Reference changed after subscribing is honoured at once. */
export async function eventVisibleTo(principal: string, msg: RealtimeEvent): Promise<boolean> {
  const payload = msg.payload as { table?: unknown; row_id?: unknown } | undefined
  if (payload?.row_id == null || typeof payload.table !== 'string') return true
  // Roles can change after subscribing (a service account's roles endpoint,
  // a person's form): read permission is rechecked too.
  if (!(await hasPermission(principal, payload.table, 'read'))) return false
  const protectedRow = await needsMandatoryRowRead(payload.table)
  if (protectedRow) return msg.event !== 'deleted' && rowInScope(principal, payload.table, String(payload.row_id))
  if (await isPrivileged(principal)) return true
  // #1454: a row of a Table about places reaches only the people whose places hold it; a deleted one, whose places
  // can no longer be read, reaches none of them (an id can name its store)
  if (await placeScoped(payload.table)) return msg.event !== 'deleted' && rowInScope(principal, payload.table, String(payload.row_id))
  const scope = await getScopeMap(principal)
  if (!scope.size && !(await scopeRequired(payload.table))) return true
  const rowId = String(payload.row_id)
  return msg.event === 'deleted' ? deletedVisible(scope, payload.table, rowId) : rowInScope(principal, payload.table, rowId)
}

// Ordering caveat: list and row events are checked asynchronously per
// subscriber before sending, so two events for the same row published in
// quick succession can reach a client out of order. They carry no data —
// only {table, row_id} — and clients refetch on any of them, so the last
// refetch shows the current row either way.
async function deliverChecked(client: Client, msg: RealtimeEvent, data: string): Promise<void> {
  const { withPlacesMemo } = await import('./place-scope')
  if ((await withPlacesMemo(() => eventVisibleTo(client.user.row_id, msg))) && client.socket.readyState === client.socket.OPEN)
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

function publish(channel: string, event: string, payload?: unknown): void {
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
    // #1222: a socket opened while viewing gets nothing once that View as no longer holds.
    if (c.viewing) {
      // A failed check must never stop the broadcast to the other sockets.
      void deliverViewing(c, msg, data).catch(/* v8 ignore next -- only a database failure inside eventVisibleTo or closeViewAsClient rejects here; no test can make the database fail mid-delivery */ () => {})
      continue
    }
    // person-rename R2: a list or row event reaches a subscriber only for a
    // row it can read now (own-Table and Reference scopes alike).
    if (channel.startsWith('list:') || channel.startsWith('row:')) void deliverChecked(c, msg, data).catch(() => {})
    else c.socket.send(data)
  }
}

/** #1222: checked afresh before each event: still viewing the same person, still allowed. */
async function deliverViewing(client: Client, msg: RealtimeEvent, data: string): Promise<void> {
  const still = await activeViewAs(client.owner, { told: false }).catch(() => null)
  if (still?.as.person !== client.viewing) { closeViewAsClient(client); return }
  if ((msg.channel.startsWith('list:') || msg.channel.startsWith('row:')) && !(await eventVisibleTo(client.user.row_id, msg))) return
  // Sent under the session's lock, after a last look: an Exit that finished first, on any server, stops it.
  const sent = await whileViewAsHolds(client.owner.sign_in!.session_id, client.viewing!, () => {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(data)
  }).catch(/* v8 ignore next -- only a database failure inside the lock rejects; it counts as no longer holding */ () => false)
  /* v8 ignore next -- a race: only an Exit or expiry landing between this delivery's first check and its lock reaches it; the same final check on an API read is tested by holding a read open across Exit (test/view-as.test.ts) */
  if (!sent) closeViewAsClient(client)
}

function closeViewAsClient(client: Client): void {
  clients.delete(client)
  client.socket.close(4009, 'view as changed')
}

/** #1222: a session's View as changed: its sockets close now, and its pages reconnect as whom they show. */
export function closeViewAsSockets(sessionId: string): void {
  for (const client of clients) if (client.owner.sign_in?.session_id === sessionId) closeViewAsClient(client)
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

// #411: sign-out ends that session's open sockets too. A socket authenticates
// once, at the upgrade, so without this it would keep receiving events after
// the token was revoked. Other sessions of the same person stay connected.
//
// Three paths, because sockets live on one instance and sign-out can land on
// another:
// - closeSessionSockets: the instance that handled the sign-out closes them at
//   once, and remembers the id for a few minutes so a socket whose upgrade was
//   already past its token check is closed the moment it registers;
// - recheckSessionSockets: every instance asks the database about its open
//   sockets every SOCKET_RECHECK_MS, so the rest converge. The same query
//   also ends sockets whose token has expired, whose person was disabled or
//   whose sessions were ended (#391), which were otherwise only checked at the upgrade.
const RECENTLY_REVOKED_MS = 5 * 60_000
const SOCKET_RECHECK_MS = 60_000
const recentlyRevoked = new Map<string, number>()

function closeSignedOut(client: Client): void {
  clients.delete(client)
  client.socket.close(4001, 'signed out')
}

function revokedHere(sessionId: string | undefined): boolean {
  if (!sessionId) return false
  const at = recentlyRevoked.get(sessionId)
  return at !== undefined && Date.now() - at < RECENTLY_REVOKED_MS
}

export function closeSessionSockets(sessionId: string): void {
  const now = Date.now()
  for (const [id, at] of recentlyRevoked) if (now - at >= RECENTLY_REVOKED_MS) recentlyRevoked.delete(id)
  recentlyRevoked.set(sessionId, now)
  for (const client of clients) if (client.owner.sign_in?.session_id === sessionId) closeSignedOut(client)
}

export async function recheckSessionSockets(): Promise<void> {
  const open = [...clients].filter((c) => c.owner.sign_in?.session_id)
  const sessions = new Map(open.map((c) => [c.owner.sign_in!.session_id, {
    jti: c.owner.sign_in!.session_id, person: c.owner.row_id, issuedAt: c.owner.sign_in!.authenticated_at, expiresAt: c.owner.sign_in!.expires_at,
  }]))
  const ended = await endedSessionIds([...sessions.values()])
  for (const client of open) if (ended.has(client.owner.sign_in!.session_id)) closeSignedOut(client)
  await recheckViewAsSockets(open.filter((c) => !ended.has(c.owner.sign_in!.session_id)))
}

/**
 * #1222: a socket serves the identity it was opened with. Once its session
 * views as someone else, or stops viewing, or may no longer view that person,
 * it is closed, and the page's reconnect opens one for whom it shows now.
 */
async function recheckViewAsSockets(open: Client[]): Promise<void> {
  if (!open.length) return
  const live = new Map((await sql`select session_id, person from view_as_session
    where session_id in ${sql(open.map((c) => c.owner.sign_in!.session_id))} and ended_at is null and expires_at > now()`)
    .map((r) => [String(r.session_id), String(r.person)]))
  for (const client of open) {
    const now = live.get(client.owner.sign_in!.session_id)
    const stillAllowed = !client.viewing || (now === client.viewing && (await activeViewAs(client.owner, { told: false }).catch(() => null))?.as.person === client.viewing)
    if (now !== client.viewing || !stillAllowed) closeViewAsClient(client)
  }
}

// Attach a WebSocket server to the shared HTTP server. Clients connect to
// /ws carrying the `sid` session cookie, then send {subscribe:[channels]} /
// {unsubscribe:[...]}. The server answers a subscribe frame with
// {channel:'system', event:'subscribed', payload:{channels:[...registered]}}.
export const MAX_FRAME_BYTES = REALTIME_MAX_FRAME_BYTES
export const MAX_PENDING_FRAMES = 32

/** What a stopping server does with its realtime sockets. */
export interface RealtimeServer {
  /** #1260: refuse new sockets, tell every open page the server is restarting
   *  (close code 1012) so it reconnects to the new server, and resolve once
   *  they are gone; one that does not finish its close in a second is dropped. */
  closeAll(): Promise<void>
  /** Drop every socket now (the shutdown deadline has passed). */
  terminateAll(): void
}

export function attachRealtime(server: Server): RealtimeServer {
  // A client only ever sends short subscribe/unsubscribe lists; anything this
  // large is refused by `ws` itself (close 1009) before it is buffered.
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_FRAME_BYTES })
  const recheck = setInterval(() => void recheckSessionSockets().catch(() => {}), SOCKET_RECHECK_MS)
  recheck.unref()
  server.on('close', () => clearInterval(recheck))
  wss.on('connection', (socket, req) => {
    // #426: listeners are attached NOW, before authentication's database round
    // trip. The browser sends its subscribe frame the moment the socket opens;
    // `ws` drops a frame that arrives while no 'message' listener exists, and
    // a dropped subscribe leaves the page subscribed to nothing, silently. So
    // frames wait on the authentication and are then handled in arrival order.
    let client: Client | null = null
    let closed = false
    // authenticate registers a client only on a socket it found open, and a
    // close event cannot land before this continuation runs.
    const authenticated = authenticate(socket, req.headers.cookie).then((c) => (client = c))
    let frames: Promise<void> = authenticated.then(() => {})
    // Frames queue only while authentication or an earlier frame's permission
    // checks are pending — a handful in practice. A client that piles up more
    // is misbehaving; it is closed rather than buffered without limit.
    let pending = 0
    socket.on('message', (raw) => {
      if (++pending > MAX_PENDING_FRAMES) {
        socket.close(1008, 'too many pending frames')
        return
      }
      frames = frames.then(async () => {
        try {
          if (client && !closed) await handleFrame(client, String(raw))
        } finally {
          pending--
        }
      })
    })
    const forget = () => {
      closed = true
      if (client) clients.delete(client)
    }
    socket.on('close', forget)
    socket.on('error', forget)
  })
  return {
    closeAll: () => new Promise<void>((resolve) => {
      // First, so an upgrade arriving from now on is refused rather than
      // joining after the others were told (Codex, #1260).
      wss.close(() => resolve())
      for (const socket of wss.clients) {
        setTimeout(() => socket.terminate(), 1000).unref()
        socket.close(1012, 'Server restarting')
      }
    }),
    terminateAll: () => {
      for (const socket of wss.clients) socket.terminate()
    },
  }
}

async function authenticate(socket: WebSocket, cookie: string | undefined): Promise<Client | null> {
  try {
    // #173: the browser cannot set headers on a WebSocket, which is why this
    // was URL-borne. But the upgrade is an ordinary same-origin HTTP request,
    // so the HttpOnly `sid` cookie is already on it — and a `?token=` in the
    // socket URL lands in proxy logs like any other. A cross-site handshake
    // carries no SameSite=Lax cookie, so this closes that door too.
    const signedIn = await resolveToken(credentialFromCookieHeader(cookie))
    // #1222: while viewing as someone, live updates follow what that person may read. Starting,
    // switching and leaving View as reload the page, so each socket serves one identity. The
    // session (and so sign-out) stays the tester's.
    const viewing = await activeViewAs(signedIn, { told: false }).catch(() => null)
    const user = viewing?.user ?? signedIn
    // Closed while the token was being checked: never register it.
    if (socket.readyState !== socket.OPEN) return null
    const client: Client = { socket, user, owner: signedIn, ...(viewing ? { viewing: viewing.as.person } : {}), channels: new Set() }
    clients.add(client)
    // #411: signed out while this upgrade was between its token check and
    // here — the sign-out's own sweep could not see it yet.
    if (revokedHere(signedIn.sign_in?.session_id)) {
      closeSignedOut(client)
      return null
    }
    // Personal channel is always subscribed.
    client.channels.add(`user:${user.row_id}`)
    socket.send(JSON.stringify({ channel: 'system', event: 'ready', payload: { user: user.row_id } }))
    return client
  } catch {
    // Only the token check can fail: the socket is still OPEN when the client
    // is registered, and ws's send on an open socket never throws.
    socket.close(4001, 'unauthorized')
    return null
  }
}

async function handleFrame(client: Client, raw: string): Promise<void> {
  const { socket } = client
  try {
    const msg = JSON.parse(raw) as {
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
}
