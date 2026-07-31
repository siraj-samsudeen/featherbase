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
