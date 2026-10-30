// What the report page shows, decided from what its two reads answered, and
// how it writes figures. Kept apart from the React code so it can be tested.
export type Answer<T> = { ok: true; value: T } | { ok: false; status?: number }
type Embed = { frame?: string; not_set_up?: boolean; unreachable?: boolean; ready_signal?: boolean }

/** Where the Dive is served from (featherbase.json's `frameOrigins`), and the message it posts once it has drawn (B7). */
export const DIVE_ORIGIN = 'https://embed-motherduck.com'
export const DIVE_READY_MESSAGE = 'feather-dash:dive-ready'
type ReportState = { state: string }

export type View =
  | { kind: 'opening' }
  | { kind: 'dive'; src: string }
  | { kind: 'quick' }
  | { kind: 'empty'; why: 'no_data_yet' | 'no_sections' | 'not_built' }
  | { kind: 'no_access' }
  | { kind: 'signed_out' }
  | { kind: 'failed' }

const refusedBy = (answer: Answer<unknown> | undefined, status: number) => answer?.ok === false && answer.status === status

/**
 * The Dive is the report. Before it opens, the cached report says whether there is
 * anything to show (no figures yet for the month, no sections in the store); the
 * quick view stands in only when the Dive can't load, and the plain message only
 * when the quick view can't load either.
 */
export function pageView({ embed, report, frameFailed = false }: {
  embed: Answer<Embed> | undefined
  report: Answer<ReportState> | undefined
  /** The Dive's frame errored, or didn't load within DIVE_READY_TIMEOUT_MS. */
  frameFailed?: boolean
}): View {
  if (refusedBy(embed, 401) || refusedBy(report, 401)) return { kind: 'signed_out' }
  if (refusedBy(embed, 403) || refusedBy(report, 403)) return { kind: 'no_access' }
  const state = report?.ok ? report.value.state : undefined
  if (state === 'no_data_yet' || state === 'no_sections') return { kind: 'empty', why: state }
  if (embed?.ok && embed.value.frame && !frameFailed) return { kind: 'dive', src: embed.value.frame }
  // Past the deadline the session request counts as failed, answered or not.
  if ((!embed && !frameFailed) || !report) return { kind: 'opening' }
  if (!report.ok) return { kind: 'failed' }
  return state === 'not_built' || state === 'unconfirmed' ? { kind: 'empty', why: 'not_built' } : { kind: 'quick' }
}

/** How long the page waits for the bar to choose a store before opening without one (a reader the bar offers none). */
export const BAR_STORE_WAIT_MS = 2_000

/**
 * Opens the report once per load: with the store in the address, at once; otherwise with the
 * store the bar writes in (its first option), or with none after BAR_STORE_WAIT_MS when the bar
 * offers nothing. Every later choice opens again. `listen` answers an unsubscribe.
 */
/** How long the check of a store named in the address may take before the page offers Try again. */
export const STORE_CHECK_TIMEOUT_MS = 10_000

/**
 * The one guard for the page's async steps (Codex rounds 7, 10, 14, 15): every step that can
 * change what is shown captures a generation when it starts, and acts only while it is still
 * current. A new attempt (`bump`: a store change, Try again) or `dispose` (unmount, a superseded
 * instance) makes every older callback, answer and timer a no-op; timers are cleared on both,
 * and none is created after disposal.
 */
export function generations() {
  let current = 0
  let disposed = false
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const alive = (token: number) => !disposed && token === current
  const clearAll = () => { for (const t of timers) clearTimeout(t); timers.clear() }
  return {
    bump(): number { clearAll(); return ++current },
    alive,
    /** A timer for `token`'s attempt: fires only while it is current. */
    after(token: number, ms: number, fire: () => void) {
      if (disposed) return undefined
      const timer = setTimeout(() => { timers.delete(timer); if (alive(token)) fire() }, ms)
      timers.add(timer)
      return timer
    },
    /** Is any timer of the current attempt still to fire (a deadline running)? */
    running: () => timers.size > 0,
    cancel(timer: ReturnType<typeof setTimeout> | undefined) { if (timer !== undefined) { clearTimeout(timer); timers.delete(timer) } },
    /** An answer for `token`'s attempt: acted on only while it is current, success or failure. */
    settle<T>(token: number, promise: Promise<T>, ok: (value: T) => void, failed?: (error: unknown) => void) {
      promise.then(value => { if (alive(token)) ok(value) }, error => { if (alive(token)) failed?.(error) })
    },
    dispose() { disposed = true; current++; clearAll() },
  }
}

export function firstStore(inAddress: string | undefined, listen: (onStore: (store: string) => void) => () => void,
  open: (store?: string) => void, waitMs = BAR_STORE_WAIT_MS, isMine?: (store: string) => Promise<boolean>,
  onCheckTimeout: () => void = () => {}, checkTimeoutMs = STORE_CHECK_TIMEOUT_MS) {
  const guard = generations()
  const token = guard.bump()
  let opened = false
  let waiting: ReturnType<typeof setTimeout> | undefined
  let checking: ReturnType<typeof setTimeout> | undefined
  const openOnce = (store?: string) => {
    if (!guard.alive(token)) return
    guard.cancel(waiting)
    guard.cancel(checking)
    opened = true
    open(store)
  }
  const stop = listen(store => openOnce(store))
  const wait = () => { waiting = guard.after(token, waitMs, () => { if (!opened) openOnce(undefined) }) }
  if (!inAddress) wait()
  else if (!isMine) openOnce(inAddress)
  else {
    // A store in the address is checked before anything is read, however long that takes: the
    // page never opens another store's figures while the bar and the address show this one.
    // One that isn't the reader's is never read: the bar corrects it (its first option), and
    // that choice opens the report; with no option at all, the page opens with none. A check
    // that fails opens the address's store, which the read itself then judges. A check that
    // takes longer than STORE_CHECK_TIMEOUT_MS offers Try again (never the default store), and
    // still opens the store if it answers later. A choice the reader makes meanwhile wins, and
    // nothing of a disposed instance (Try again starts a new one) acts at all.
    checking = guard.after(token, checkTimeoutMs, () => { if (!opened) onCheckTimeout() })
    guard.settle(token, isMine(inAddress),
      mine => { if (opened) return; if (mine) openOnce(inAddress); else wait() },
      () => { if (!opened) openOnce(inAddress) })
  }
  return () => { guard.dispose(); stop() }
}

/** The quick view's footnote for `n` shown subcategories with a "—". */
export function blankNote(n: number): string {
  return `${n} ${n === 1 ? 'subcategory has' : 'subcategories have'} no target or no sales recorded this month: “—” means nothing was recorded, never ₹0.00.`
}

/** How long the cached report has to answer; then it counts as failed and a late answer is ignored. */
export const REPORT_TIMEOUT_MS = 15_000

/** How long the Dive has, from the session request to its frame loading, before the page falls back to the quick view. */
export const DIVE_READY_TIMEOUT_MS = 15_000

/**
 * The page's one way to choose a store (Codex round 9): the store on show, repeated by the bar
 * or by Back/Forward, changes nothing (no reset, no new attempt), so a reset can never leave
 * the page waiting with nothing in flight. Any other store drops the previous store's answers at
 * once (`select`) and then sets the store, whose effect opens it.
 */
export function storeChooser(loader: { select(store: string): void }, setStore: (store?: string) => void) {
  let chosen: { value?: string } | undefined
  return (value?: string) => {
    if (chosen && chosen.value === value) return
    chosen = { value }
    if (value) loader.select(value)
    setStore(value)
  }
}

/**
 * What may be drawn for the store now chosen: a state published for any other store draws
 * nothing (defence in depth behind `select`, round 8).
 */
export function visibleState<S extends { store?: string; embed: unknown; report: unknown; frameFailed: boolean; diveReady: boolean }>(state: S, store: string | undefined): S {
  return state.store === store ? state : { ...state, store, embed: undefined, report: undefined, frameFailed: false, diveReady: false }
}

/**
 * Rupees, Indian digit grouping, exactly two decimals: the quick view's figures must foot
 * (gap = sales − target, totals = the rows), so they are never rounded to whole rupees
 * (AGENTS.md "Amount display"). A missing figure is a dash.
 */
export function inr(value: number | null): string {
  if (value == null) return '—'
  const paise = Math.round(Math.abs(value) * 100)
  const digits = String(Math.floor(paise / 100))
  const last3 = digits.slice(-3)
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return `${value < 0 && paise !== 0 ? '−' : ''}₹${rest ? `${rest},${last3}` : last3}.${String(paise % 100).padStart(2, '0')}`
}

/** An achievement to one decimal, as the old report wrote it. */
export function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 10) / 10}%`
}

/** A gap with its sign both ways ("+₹2,500.00", "−₹2,500.00"), as the old report wrote it. */
export function signedInr(value: number | null): string {
  return value != null && Math.round(value * 100) > 0 ? `+${inr(value)}` : inr(value)
}

/** Under the quick view's table: what the old report's totals already did, said. */
export const TOTALS_NOTE = 'Totals add every target and every sale in the table, including subcategories that have only one of them, so they can differ from the sum of the gaps shown.'

/** A section's subtotal names the section, so a table scrolled sideways still says whose total it is. */
export function subtotalLabel(section: string | null): string {
  // "No section" never breaks, so a narrow column wraps it as "No section / total".
  return section ? `${section} total` : 'No\u00a0section total'
}

/** A section's heading row: its name, or "No section" for subcategories in none. */
export function sectionHeading(section: string | null): string {
  return section ?? 'No section'
}

/**
 * A subtotal's or total's cells under the display rule: "—" for a value none of its rows
 * recorded; the gap and achievement only when the group recorded both. The figures drawn are
 * the old report's sums, unchanged.
 */
export function totalCells(t: { target: number | null; actual: number | null; gap: number | null; achievement: number | null;
  targets_recorded: number; sales_recorded: number }) {
  const both = t.targets_recorded > 0 && t.sales_recorded > 0
  return {
    target: t.targets_recorded > 0 ? inr(t.target) : '—',
    sales: t.sales_recorded > 0 ? inr(t.actual) : '—',
    gap: both ? signedInr(t.gap) : '—',
    achieved: both ? percent(t.achievement) : '—',
  }
}

/** A subcategory's label: its name alone, never its code (#4531); "Unnamed subcategory" when it has none. */
export function subcategoryLabel(row: { code: string; subcategory: string | null }) {
  return row.subcategory ? { name: row.subcategory, unnamed: false } : { name: 'Unnamed subcategory', unnamed: true }
}

/** The quick view's body: the table, or a sentence when every row is hidden (no target and no sales). */
export function quickBody(rows: readonly { noTargetNoSale: boolean }[], showQuiet: boolean): 'table' | 'nothing' {
  return showQuiet || rows.some(r => !r.noTargetNoSale) ? 'table' : 'nothing'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** An ISO day as DD-Mon-YYYY. */
export function shortDay(day: string | null): string {
  if (!day) return '—'
  const [y, m, d] = day.slice(0, 10).split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}

/** An ISO instant as HH:MM IST. */
export function istTime(instant: string | null): string {
  if (!instant) return '—'
  return `${new Date(new Date(instant).getTime() + 330 * 60_000).toISOString().slice(11, 16)} IST`
}

/** The one timestamp line, in its cached wording. */
export function dataLine({ data_through, refreshed_at }: { data_through: string | null; refreshed_at: string | null }): string {
  return `Data to ${shortDay(data_through)} · refreshed ${istTime(refreshed_at)}`
}

/** What the page has heard so far for the store on show. */
export interface LoadState<R = unknown, E = Embed> {
  /** The store this state was opened for; rendering ignores a state of another store. */
  store?: string
  embed: Answer<E> | undefined
  report: Answer<R> | undefined
  frameFailed: boolean
  /** The Dive is up: its frame loaded (no ready signal) or it said it is ready. */
  diveReady: boolean
}

function answered<T>(promise: Promise<T>): Promise<Answer<T>> {
  return promise.then(
    value => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, status: (error as { status?: number } | null)?.status }),
  )
}

/**
 * Opens the report for a store: the cached report and the Dive's session are asked for
 * together, and one deadline (DIVE_READY_TIMEOUT_MS) covers the session request and the
 * frame loading. Past it, the page shows the quick view, and a session that answers late is
 * ignored. Opening another store ignores everything the previous one still has in flight.
 */
export function reportLoader<R = unknown>(read: (name: string, payload: Record<string, unknown>) => Promise<unknown>,
  publish: (state: LoadState<R>) => void, timeoutMs = DIVE_READY_TIMEOUT_MS, reportTimeoutMs = REPORT_TIMEOUT_MS) {
  const guard = generations()
  let token = 0
  let state: LoadState<R> = { embed: undefined, report: undefined, frameFailed: false, diveReady: false }
  let deadline: ReturnType<typeof setTimeout> | undefined
  const update = (opened: number, patch: Partial<LoadState<R>>) => {
    if (!guard.alive(opened)) return
    state = { ...state, ...patch }
    publish(state)
  }
  return {
    /**
     * The reader chose `store`: everything in flight for the previous store is dropped NOW,
     * before React's effect opens the new one, so no answer can land in between (round 8).
     */
    select(store: string) {
      token = guard.bump()
      state = { store, embed: undefined, report: undefined, frameFailed: false, diveReady: false }
      publish(state)
    },
    open(store?: string) {
      const opened = token = guard.bump()
      state = { store, embed: undefined, report: undefined, frameFailed: false, diveReady: false }
      publish(state)
      const payload = store ? { store } : {}
      deadline = guard.after(opened, timeoutMs, () => update(opened, { frameFailed: true }))
      // The cached report gets its own deadline: past it, it counts as failed (the page then shows
      // the Dive if it works, or "couldn't load" with Try again), and a late answer is ignored.
      const reportDeadline = guard.after(opened, reportTimeoutMs, () => { if (!state.report) update(opened, { report: { ok: false } }) })
      guard.settle(opened, answered(read('report', payload) as Promise<R>), report => {
        if (state.report) return
        guard.cancel(reportDeadline)
        update(opened, { report })
      })
      guard.settle(opened, answered(read('embed_session', payload) as Promise<Embed>), embed => {
        if (!state.frameFailed) update(opened, { embed })
      })
    },
    /** The attempt now on show, for a frame to name when it reports back. */
    current: () => token,
    /** Is the attempt on show still running (a deadline yet to fire)? */
    running: () => guard.running(),
    /**
     * The Dive's frame fired `load`. Without the ready signal (`dive_ready_signal` off) that is
     * taken as ready; with it, `load` is provisional (an error page loads too) and the deadline
     * keeps running until the Dive's own ready message arrives. A frame of an earlier attempt
     * (`attempt`) is ignored.
     */
    frameLoaded(attempt = token) {
      if (!guard.alive(attempt)) return
      // Only a frame the session answered can load; anything else must not stop the deadline.
      if (!(state.embed?.ok && (state.embed.value as Embed).frame)) return
      if ((state.embed.value as Embed).ready_signal) return
      guard.cancel(deadline)
      update(attempt, { diveReady: true })
    },
    /** A window message: the Dive's ready signal only from the Dive's origin and its own frame. */
    message(event: { origin: string; source: unknown; data: unknown }, frameWindow: unknown, attempt = token) {
      if (!guard.alive(attempt)) return
      if (event.origin !== DIVE_ORIGIN || !frameWindow || event.source !== frameWindow) return
      if ((event.data as { type?: unknown } | null)?.type !== DIVE_READY_MESSAGE || state.frameFailed) return
      guard.cancel(deadline)
      update(attempt, { diveReady: true })
    },
    /** The Dive's frame errored. */
    frameFailed(attempt = token) {
      if (!guard.alive(attempt)) return
      guard.cancel(deadline)
      update(attempt, { frameFailed: true })
    },
    /** Nothing in flight acts any more (a store change, Try again, unmount). */
    close() { token = guard.bump() },
  }
}

/** The page header's last line: what the figures measure, in the old page's words (#4486). */
export const MEASURE_LINE = 'Sales before tax, net of returns'

/** The period the figures cover, DD-Mon-YYYY to DD-Mon-YYYY. */
export function periodLine({ period_start, period_end }: { period_start: string; period_end: string }): string {
  return `${shortDay(period_start)} to ${shortDay(period_end)}`
}

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Sections as the header names them: up to three by name, from four on by count; null for none. */
function sectionsNamed(sections: readonly string[], join: (names: readonly string[]) => string = listed): string | null {
  if (!sections.length) return null
  return sections.length <= 3 ? join(sections) : `${sections.length} sections`
}

/** The header's title: the store's short name and its sections ("LKS · Alpha · Beta", "LKS · 4 sections"). */
export function headingTitle({ name, sections }: { name: string | null; sections: readonly string[] }): string {
  const named = sectionsNamed(sections, names => names.join(' · '))
  return [name ?? 'Your store', ...(named ? [named] : [])].join(' · ')
}

/**
 * Every basis a place can carry, in the order a sentence gives them: leadership first (the old
 * page's SCOPE_BASES order), the new org chart's Cluster Manager after Store Manager and Floor
 * Manager before Department Manager. `store` jobs name the store; `section` jobs name sections.
 */
const REASONS = [
  { basis: 'store_manager', job: 'Store Manager', covers: 'store' },
  { basis: 'cluster_manager', job: 'Cluster Manager', covers: 'store' },
  { basis: 'floor_manager', job: 'Floor Manager', covers: 'section' },
  { basis: 'department_manager', job: 'Department Manager', covers: 'section' },
  { basis: 'team_leader', job: 'Team Leader', covers: 'section' },
  { basis: 'section_staff', job: null, covers: 'staff' },
  { basis: 'assignment', job: null, covers: 'assigned' },
] as const

type Known = { rank: number; acting: boolean; job: string | null; covers: (typeof REASONS)[number]['covers']; sections: string[] }

/** The reasons the page knows, merged per job and in sentence order; an unknown basis is left out. */
function knownReasons(reasons: readonly { basis: string; sections: readonly string[] }[]): Known[] {
  const merged = new Map<string, Known>()
  for (const { basis, sections } of reasons) {
    const acting = basis.startsWith('acting_')
    const rank = REASONS.findIndex(r => r.basis === (acting ? basis.slice('acting_'.length) : basis))
    if (rank < 0) continue
    const { job, covers } = REASONS[rank]
    // Acting staff work in the section as staff do: one reason, one wording.
    const asActing = acting && covers !== 'staff' && covers !== 'assigned'
    const key = `${rank}:${asActing}`
    const known = merged.get(key) ?? { rank, acting: asActing, job: job && asActing ? `acting ${job}` : job, covers, sections: [] }
    for (const s of sections) if (!known.sections.includes(s)) known.sections.push(s)
    merged.set(key, known)
  }
  return [...merged.values()].sort((a, b) => a.rank - b.rank || Number(a.acting) - Number(b.acting))
}

/**
 * Why the reader sees the store (#4486), one sentence, or null when no reason is known (never an
 * empty "because you are ."). `name` is the store's short name; null says "your store" (the title's "Your store"), never a
 * plant code. A Store or Cluster Manager's sentence names the store; any other names its sections
 * (three by name, from four on by count); assigned subcategories name none.
 */
export function whyLine({ name, reasons }: { name: string | null; reasons: readonly { basis: string; sections: readonly string[] }[] }): string | null {
  const known = knownReasons(reasons)
  if (!known.length) return null
  const store = name ?? 'your store'
  const sectionsOf = (r: Known) => sectionsNamed(r.sections) ?? 'these subcategories'
  const whole = known.filter(r => r.covers === 'store')
  const leads = known.filter(r => r.covers === 'section')
  const staff = known.find(r => r.covers === 'staff')
  const assigned = known.find(r => r.covers === 'assigned')

  if (!whole.length && known.length === 1) {
    const [only] = known
    if (only.covers === 'assigned') return `You see these subcategories at ${store} because they are assigned to you.`
    const what = `You see ${sectionsOf(only)} at ${store}`
    return only.covers === 'staff' ? `${what} because you work in them.` : `${what} because you are their ${only.job}.`
  }

  const jobs = [...whole.map((r, i) => `${i === 0 ? 'its ' : ''}${r.job}`), ...leads.map(r => `${r.job} of ${sectionsOf(r)}`)]
  const clauses = [
    ...(jobs.length ? [`are ${listed(jobs)}`] : []),
    ...(staff ? [`work in ${sectionsOf(staff)}`] : []),
    ...(assigned ? [`have ${jobs.length || staff ? 'other ' : ''}subcategories assigned to you`] : []),
  ]
  // In the title's order, whichever job names them.
  const seen = [...new Set([...leads, ...(staff ? [staff] : [])].flatMap(r => r.sections))].sort((a, b) => a.localeCompare(b))
  const what = whole.length ? store : `${sectionsNamed(seen) ?? 'these subcategories'} at ${store}`
  return `You see ${what} because you ${listed(clauses)}.`
}
