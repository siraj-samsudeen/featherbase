// Recent actions (issue #101, Phase 1): a per-user localStorage ring buffer
// of what the operator visited — rows, filtered lists, reports, searches —
// feeding the awesomebar's recents groups. Client-side only by design; the
// server-side `user_event` log is a later phase of the same issue.

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

export function recordAction(user: string, action: RecentAction, now = Date.now()): void {
  const entries = loadAll(user)
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
  save(user, entries)
  enqueueServerEvent(action, now)
}

// ---- #101 Phase 3: server mirror -------------------------------------------
// The localStorage buffer stays the zero-latency source for the UI; every
// recorded action is ALSO queued for the server's user_event log (debounced
// batch POST, sendBeacon on unload) so recents survive devices and feed the
// homepage activity stream. The sink is injected by the app shell — this
// module stays free of api.ts so unit tests never touch the network.

export interface ServerEventSink {
  post: (events: Array<Record<string, unknown>>) => void
  beacon: (events: Array<Record<string, unknown>>) => void
}

const FLUSH_DELAY_MS = 3000
let sink: ServerEventSink | null = null
let queue: Array<Record<string, unknown>> = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush(useBeacon = false): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!sink || queue.length === 0) return
  const batch = queue.slice(0, 50)
  queue = queue.slice(50)
  if (useBeacon) sink.beacon(batch)
  else sink.post(batch)
  if (queue.length > 0) flushTimer = setTimeout(() => flush(), FLUSH_DELAY_MS)
}

function enqueueServerEvent(action: RecentAction, at: number): void {
  if (!sink) return
  queue.push({
    kind: action.kind,
    key: action.key,
    label: action.label,
    sub: action.sub,
    path: action.path,
    at,
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

/** Cross-device merge: union the server's per-key aggregates into the local
 *  buffer (visits merged, deduplicated, capped — same shape both sides). */
export function mergeServerEntries(user: string, remote: ServerRecentEntry[]): void {
  if (remote.length === 0) return
  const entries = loadAll(user)
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
        visits: r.visits.slice(-MAX_VISITS),
      })
    }
  }
  entries.sort((a, b) => lastVisit(a) - lastVisit(b))
  entries.splice(0, Math.max(0, entries.length - MAX_ENTRIES))
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

export function frecency(entry: RecentEntry, now = Date.now()): number {
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
export function describeFilters(filtersJson: string | undefined): string | undefined {
  if (!filtersJson) return undefined
  try {
    const filters: unknown = JSON.parse(filtersJson)
    if (!Array.isArray(filters) || filters.length === 0) return undefined
    const parts = filters
      .filter((f): f is [string, string, unknown] => Array.isArray(f) && f.length >= 3)
      .map((f) => `${f[0]} ${f[1]} ${String(f[2])}`)
    return parts.length ? parts.join(' · ') : undefined
  } catch {
    return undefined
  }
}

// Admin sub-routes whose first segment is a fixed page, not a Table name.
// 'home' is the landing surface every session passes through — remembering
// it would pin a useless entry to the top of Recent.
const RESERVED = new Set([
  'new-table', 'import', 'jobs', 'all-tables', 'naming', 'permissions', 'home',
])
const PAGE_KINDS: Record<string, string> = {
  'query-report': 'Report',
  'script-report': 'Report',
  dashboard: 'Dashboard',
}

/**
 * Map an admin location to the action it represents, or null for locations
 * not worth remembering (home, builders, transient "new" forms).
 */
export function actionForLocation(
  pathname: string,
  search: Record<string, unknown>,
): RecentAction | null {
  const m = /^\/admin(?:\/(.*))?$/.exec(pathname)
  if (!m || !m[1]) return null
  const segs = m[1].split('/').map((s) => decodeURIComponent(s)).filter(Boolean)
  if (segs.length === 0) return null

  const pageKind = PAGE_KINDS[segs[0]]
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
  if (RESERVED.has(segs[0]) || pageKind) return null

  const doctype = segs[0]
  const filtersJson = typeof search.filters === 'string' ? search.filters : undefined
  if (segs.length === 1 || segs[1] === 'view') {
    const mode = segs[1] === 'view' ? segs[2] : undefined
    const sub = [mode, describeFilters(filtersJson)].filter(Boolean).join(' · ') || undefined
    const href = filtersJson ? `${pathname}?filters=${encodeURIComponent(filtersJson)}` : pathname
    return {
      kind: 'list',
      key: `list:${doctype}${mode ? `/${mode}` : ''}?${filtersJson ?? ''}`,
      label: doctype,
      sub,
      path: href,
    }
  }
  if (segs.length === 2 && segs[1] !== 'new') {
    return {
      kind: 'row',
      key: `row:${doctype}/${segs[1]}`,
      label: segs[1],
      sub: doctype,
      path: pathname,
    }
  }
  return null
}

/** Compact relative age for recents rows: "now", "5m", "3h", "2d". */
export function ago(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - ts)
  if (d < 60_000) return 'now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`
  if (d < DAY) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / DAY)}d`
}
