// Per-user warm history cache, reconciled with the server on app load.

import { ADMIN_NAMED_PAGE_KINDS, ADMIN_UNRECORDED_ROOTS, adminPageTitle, adminPathTitle, choiceLabel } from 'shared'
import type { ColumnDef } from './meta'

export type RecentKind = 'row' | 'list' | 'page' | 'search'

export interface RecentAction {
  kind: RecentKind
  /** Dedup identity — revisiting bumps the entry, never duplicates it. */
  key: string
  label: string
  sub?: string
  /** In-app href to replay the action ('' for searches — they refill the bar). */
  path: string
}

export interface RecentEntry extends RecentAction {
  /** Visit timestamps (epoch ms), oldest first, capped at MAX_VISITS. */
  visits: number[]
}

const MAX_ENTRIES = 80
const MAX_VISITS = 10
const DAY = 86_400_000

const storageKey = (user: string) => `fc-recents:${user}`
const lastVisit = (e: RecentEntry) => e.visits[e.visits.length - 1] ?? 0

function loadAll(user: string): RecentEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(user))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as RecentEntry[]) : []
  } catch {
    return []
  }
}

function save(user: string, entries: RecentEntry[]): void {
  try {
    localStorage.setItem(storageKey(user), JSON.stringify(entries))
  } catch {
    // Storage full or blocked — recents are best-effort, never fatal.
  }
}

// Unlike the transport queue this journal survives a flush, including failed
// delivery and a summary captured before a successful POST. Only a summary
// containing a visit confirms it. It has the same bounds as the visible cache.
const unconfirmed = new Map<string, { entries: RecentEntry[]; remote?: RecentEntry[] }>()

/** A completed session must not contribute visits to a later sign-in. */
export function clearVisitJournal(): void {
  unconfirmed.clear()
}

function remember(entries: RecentEntry[], action: RecentAction, now: number): void {
  const existing = entries.find((e) => e.key === action.key)
  if (existing) {
    Object.assign(existing, action)
    existing.visits = [...existing.visits.slice(-(MAX_VISITS - 1)), now]
  } else {
    entries.push({ ...action, visits: [now] })
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => lastVisit(a) - lastVisit(b))
      entries.splice(0, entries.length - MAX_ENTRIES)
    }
  }
}

export function recordAction(user: string, action: RecentAction, now = Date.now()): void {
  const entries = loadAll(user)
  remember(entries, action, now)
  save(user, entries)
  const journal = unconfirmed.get(user) ?? { entries: [] }
  remember(journal.entries, action, now)
  unconfirmed.set(user, journal)
  enqueueServerEvent(user, action, now)
}

// ---- #101 Phase 3: server mirror -------------------------------------------
// The localStorage buffer stays the zero-latency source for the UI; every
// recorded action is ALSO queued for the server's user_event log (debounced
// batch POST, sendBeacon on unload) so recents survive devices and feed the
// homepage activity stream. The sink is injected by the app shell — this
// module stays free of api.ts so unit tests never touch the network.
//
// Every queued event is tagged with its owner, and a flush only ever sends
// events whose owner IS the session the sink would authenticate as; anything
// else is discarded, never re-attributed (PR #104 review: A's trail must not
// land under B when the account changes mid-debounce). Logout flushes A's
// remainder while A's credentials still exist — see AdminLayout.logout.

interface ServerEventSink {
  /** The user the transport would authenticate as right now. */
  currentUser: () => string | null
  post: (events: Array<Record<string, unknown>>, recorded: (timestamps: number[]) => void) => void
  beacon: (events: Array<Record<string, unknown>>) => void
}

const FLUSH_DELAY_MS = 3000
let sink: ServerEventSink | null = null
let queue: Array<{ owner: string; event: Record<string, unknown> }> = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush(useBeacon = false): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!sink) return
  const current = sink.currentUser()
  // A departing session's unconfirmed visits must not leak into a later
  // sign-in. Its cache remains available only if that sign-in's summary fails.
  for (const owner of unconfirmed.keys()) {
    if (owner !== current) unconfirmed.delete(owner)
  }
  if (queue.length === 0) return
  // Fail closed: whatever does not belong to the authenticated session is
  // dropped — delivery is best-effort, attribution is not.
  const mine = current ? queue.filter((q) => q.owner === current) : []
  queue = []
  if (mine.length === 0) return
  const batch = mine.slice(0, 50).map((q) => q.event)
  if (useBeacon) sink.beacon(batch)
  else {
    const owner = current!
    const journal = unconfirmed.get(owner)
    sink.post(batch, (timestamps) => {
      // A late acknowledgement must not mutate a later session, even when
      // the same person signs back in before the POST completes.
      if (!journal || unconfirmed.get(owner) !== journal || sink?.currentUser() !== owner) return
      const cached = loadAll(owner)
      for (const entries of [journal.entries, cached]) {
        for (const entry of entries) {
          entry.visits = [...new Set(entry.visits.map((at) => {
            const index = batch.findIndex((event) => event.key === entry.key && event.at === at)
            return index < 0 ? at : timestamps[index]
          }))].sort((a, b) => a - b)
        }
      }
      // Delivery does not retire a visit: a summary captured before the POST
      // can still arrive later. Reconcile against the latest actual snapshot.
      if (journal.remote) replaceServerEntries(owner, journal.remote)
      else save(owner, cached)
    })
  }
  if (mine.length > 50) {
    queue = mine.slice(50)
    flushTimer = setTimeout(() => flush(), FLUSH_DELAY_MS)
  }
}

// #871: a renamed Table's entries follow it, here as on the server: the
// cached list, unconfirmed visits and events not yet sent all name the new
// Table, so a visit made just before the rename does not bring the old back.
export function renameTableInRecents(user: string, from: string, to: string, fromPath: string, toPath: string): void {
  const moved = <T extends { key?: unknown; label?: unknown; sub?: unknown; path?: unknown }>(entry: T): T => {
    const key = String(entry.key ?? '')
    const prefix = ['row:', 'list:'].find((kind) => key.startsWith(kind + from) && ['/', '?'].includes(key.charAt(kind.length + from.length)))
    if (!prefix) return entry
    const path = String(entry.path ?? '')
    return {
      ...entry,
      key: prefix + to + key.slice(prefix.length + from.length),
      label: entry.label === from ? to : entry.label,
      sub: entry.sub === from ? to : entry.sub,
      path: path === fromPath || path.startsWith(fromPath + '/') || path.startsWith(fromPath + '?') ? toPath + path.slice(fromPath.length) : path,
    }
  }
  save(user, loadAll(user).map(moved))
  const journal = unconfirmed.get(user)
  if (journal) journal.entries = journal.entries.map(moved)
  queue = queue.map((q) => (q.owner === user ? { ...q, event: moved(q.event) } : q))
}

/** Drain the queue NOW (e.g. right before sign-out, while the departing
 *  user's credentials still exist). */
export function flushPendingEvents(): void {
  flush()
}

function enqueueServerEvent(owner: string, action: RecentAction, at: number): void {
  if (!sink) return
  queue.push({
    owner,
    event: {
      kind: action.kind,
      key: action.key,
      label: action.label,
      sub: action.sub,
      path: action.path,
      at,
    },
  })
  if (!flushTimer) flushTimer = setTimeout(() => flush(), FLUSH_DELAY_MS)
}

/** App-shell hookup; safe to call more than once (last sink wins). */
export function connectEventSink(next: ServerEventSink): void {
  const first = sink === null
  sink = next
  if (first && typeof window !== 'undefined') {
    // pagehide covers tab close, reload and navigation away — the last
    // debounce window must not be lost, and only a beacon survives unload.
    window.addEventListener('pagehide', () => flush(true))
  }
}

export interface ServerRecentEntry {
  kind: string
  key: string
  label: string
  sub?: string
  path: string
  visits: number[]
}

/** Replace cached history, folding this document's unconfirmed visits on top. */
export function replaceServerEntries(user: string, remote: ServerRecentEntry[]): void {
  const entries: RecentEntry[] = []
  for (const r of remote) {
    if (!['row', 'list', 'page', 'search'].includes(r.kind) || !r.key) continue
    const existing = entries.find((e) => e.key === r.key)
    if (existing) {
      const merged = [...new Set([...existing.visits, ...r.visits])].sort((a, b) => a - b)
      existing.visits = merged.slice(-MAX_VISITS)
    } else {
      entries.push({
        kind: r.kind as RecentKind,
        key: r.key,
        label: r.label || r.key,
        sub: r.sub,
        path: r.path,
        visits: [...new Set(r.visits)].sort((a, b) => a - b).slice(-MAX_VISITS),
      })
    }
  }
  const journal = unconfirmed.get(user) ?? { entries: [] }
  journal.remote = entries.map((entry) => ({ ...entry, visits: [...entry.visits] }))
  const pending: RecentEntry[] = []
  for (const local of journal.entries) {
    const confirmed = entries.find((e) => e.key === local.key)
    const visits = local.visits.filter((at) => !confirmed?.visits.includes(at))
    if (visits.length) pending.push({ ...local, visits })
  }
  journal.entries = pending
  unconfirmed.set(user, journal)
  for (const local of pending) {
    const existing = entries.find((e) => e.key === local.key)
    if (existing) {
      Object.assign(existing, local, { visits: [...new Set([...existing.visits, ...local.visits])].sort((a, b) => a - b).slice(-MAX_VISITS) })
    } else {
      entries.push(local)
    }
  }
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => lastVisit(a) - lastVisit(b))
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
  save(user, entries)
}

/** Newest-first, deduplicated by construction. */
export function recentActions(user: string, limit: number): RecentEntry[] {
  return loadAll(user)
    .sort((a, b) => lastVisit(b) - lastVisit(a))
    .slice(0, limit)
}

// Firefox-style bucketed frecency: each visit contributes a weight by age;
// weights sum per target.
function visitWeight(age: number): number {
  if (age < 4 * DAY) return 100
  if (age < 14 * DAY) return 70
  if (age < 31 * DAY) return 50
  if (age < 90 * DAY) return 30
  return 10
}

export function frecency(entry: RecentEntry, now: number): number {
  return entry.visits.reduce((sum, t) => sum + visitWeight(now - t), 0)
}

/** Frecency-ranked repeat destinations (2+ visits; searches excluded). */
export function frequentActions(user: string, limit: number, now = Date.now()): RecentEntry[] {
  return loadAll(user)
    .filter((e) => e.kind !== 'search' && e.visits.length >= 2)
    .sort((a, b) => frecency(b, now) - frecency(a, now))
    .slice(0, limit)
}

/** Past searches matching a prefix (all of them when the bar is empty). */
export function recentSearches(user: string, query: string, limit: number): RecentEntry[] {
  const needle = query.trim().toLowerCase()
  return loadAll(user)
    .filter(
      (e) =>
        e.kind === 'search' &&
        (!needle || (e.label.toLowerCase().includes(needle) && e.label.toLowerCase() !== needle)),
    )
    .sort((a, b) => lastVisit(b) - lastVisit(a))
    .slice(0, limit)
}

/** "status = Overdue · region = South" from the list route's JSON filters. */
export function describeFilters(
  filtersJson: string | undefined,
  columns: Pick<ColumnDef, 'column_name' | 'label' | 'column_type' | 'choice_labels'>[] = [],
  t: (text: string) => string = text => text,
): string | undefined {
  if (!filtersJson) return undefined
  try {
    const filters: unknown = JSON.parse(filtersJson)
    if (!Array.isArray(filters) || filters.length === 0) return undefined
    const parts = filters
      .filter((f): f is [string, string, unknown] => Array.isArray(f) && f.length >= 3)
      .map((f) => {
        const column = columns.find(c => c.column_name === f[0])
        const value = column?.column_type === 'Choice' && ['=', '!='].includes(f[1])
          ? choiceLabel(String(f[2]), column.choice_labels, t)
          : String(f[2])
        return `${t(column?.label ?? f[0])} ${f[1]} ${value}`
      })
    return parts.length ? parts.join(' · ') : undefined
  } catch {
    return undefined
  }
}

// Admin first segments that are not Tables come from the shared catalog
// (packages/shared/src/app-routes.ts): titled static pages are remembered as
// pages; the unrecorded roots (home, builders, browsers) are not remembered.
const UNRECORDED = new Set<string>(ADMIN_UNRECORDED_ROOTS)

/**
 * Map an admin location to the action it represents, or null for locations
 * not worth remembering (home, builders, transient "new" forms).
 */
export function actionForLocation(
  pathname: string,
  search: Record<string, unknown>,
  canonicalTable?: string,
  navigatedPath?: string,
  columns?: Pick<ColumnDef, 'column_name' | 'label' | 'column_type' | 'choice_labels'>[],
  t?: (text: string) => string,
): RecentAction | null {
  const m = /^\/featherbase\/admin(?:\/(.*))?$/.exec(pathname)
  if (!m || !m[1]) return null
  const segs = m[1].split('/').map((s) => decodeURIComponent(s)).filter(Boolean)
  if (segs.length === 0) return null

  const staticTitle = segs.length === 1 && !UNRECORDED.has(segs[0]) ? adminPageTitle(segs[0]) : undefined
  if (staticTitle)
    return { kind: 'page', key: `page:${segs[0]}`, label: staticTitle, path: pathname }

  const pageKind = ADMIN_NAMED_PAGE_KINDS[segs[0]]
  if (pageKind && segs[1]) {
    const name = segs[1]
    return {
      kind: 'page',
      key: `page:${segs[0]}/${name}`,
      label: name,
      sub: pageKind,
      path: pathname,
    }
  }
  if (UNRECORDED.has(segs[0]) || pageKind) return null

  // Only metadata can supply an identity for a Table address. Never record
  // the slug as its label/key, nor interpret a fixed page as a Table.
  if (segs[0] !== 'table' || !segs[1] || !canonicalTable) return null
  const table = canonicalTable
  const filtersJson = typeof search.filters === 'string' ? search.filters : undefined
  const query = Object.entries(search)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value))}`)
    .join('&')
  const href = navigatedPath ?? (query ? `${pathname}?${query}` : pathname)
  if (segs.length === 2 || (segs.length === 4 && segs[2] === 'view')) {
    const mode = segs[2] === 'view' ? segs[3] : undefined
    const sub = [mode, describeFilters(filtersJson, columns, t)].filter(Boolean).join(' · ') || undefined
    return {
      kind: 'list',
      key: `list:${table}${mode ? `/${mode}` : ''}?${filtersJson ?? ''}`,
      label: table,
      sub,
      path: href,
    }
  }
  if (segs.length === 4 && segs[2] === 'row') {
    return {
      kind: 'row',
      key: `row:${table}/${segs[3]}`,
      label: segs[3],
      sub: table,
      path: href,
    }
  }
  return null
}

interface EntryDisplay {
  kind: RecentKind
  label: string
  sub?: string
  /** Set for a row: whose title to show in place of its id. */
  row?: { table: string; rowId: string }
}

/**
 * How a remembered destination reads, decided at RENDER time so entries
 * recorded before a rule existed read the same as new ones: a fixed admin
 * page is a page with its catalog title (an old entry may be a 'list'
 * labelled with the slug, #442), and a row names its Table as the sub-line
 * and asks for its title by reference. `kind` may be absent (a pinned
 * workspace target); the key's prefix decides then.
 */
export function displayEntry(entry: {
  kind?: RecentKind
  key: string
  label: string
  sub?: string
  path: string
}): EntryDisplay {
  const kind = entry.kind ?? ((entry.key.split(':')[0] as RecentKind) || 'list')
  if (kind === 'list' || kind === 'page') {
    const title = adminPathTitle(entry.path)
    if (title) return { kind: 'page', label: title }
  }
  if (kind === 'row' && entry.sub && entry.key === `row:${entry.sub}/${entry.label}`)
    return { kind, label: entry.label, sub: entry.sub, row: { table: entry.sub, rowId: entry.label } }
  return { kind, label: entry.label, sub: entry.sub }
}

/** One entry per destination as a person reads it: an old slug-keyed entry
 *  and a new page entry for the same page are one place. Order kept. */
export function uniqueByDisplay<T extends RecentEntry>(entries: T[]): T[] {
  const seen = new Set<string>()
  return entries.filter((e) => {
    const shown = displayEntry(e)
    const id = shown.kind === 'page' && !shown.sub ? `page:${shown.label}` : e.key
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** Compact relative age for recents rows: "now", "5m", "3h", "2d". */
export function ago(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - ts)
  if (d < 60_000) return 'now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`
  if (d < DAY) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / DAY)}d`
}
