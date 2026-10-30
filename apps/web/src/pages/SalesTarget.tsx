import { useEffect, useRef, useState } from 'react'
import { Button, Notice, Select, cardClasses } from '../components/ui'
import { ApiError, api, clearSession, getSessionUser, getToken } from '../lib/api'
import { TopBar } from '../components/TopBar'
import { ThemeChoiceProvider } from '../lib/theme-choice'
import { SCOPE_BASES, type ScopeBasis } from 'shared'
import { fmtDate as fmtDay, fmtExact, fmtInstantIST, fmtPct, fmtSigned } from '../lib/inr'

// #3755: the personalised sales-target report. The page holds no report
// logic — MotherDuck renders the Dive inside a sandboxed iframe. What the page
// owns: the identity chrome (who, which store, which period), one fresh
// embed-session request per opening, honest empty/error states that can never
// read as zero sales, and sign-out. The server decides the assignment and the
// embed origin. #409: a reader with several stores picks one of the stores the
// server listed; the server checks the pick against their own stores again.

interface Me {
  /** null for a person who has none — StyleHR people sign in by ID and have no username. */
  username: string | null
  display_name: string
  /** #409: every store the reader can open, one at a time; one entry for most readers. */
  stores: StoreScope[]
  default_store: string | null
  period_start: string
  period_end: string
  embed_origin: string
}

interface StoreScope {
  plant_code: string
  store_name: string | null
  sections: string[]
  scope_basis: ScopeBasis[]
}

// The last store a reader chose, per viewer on this device. A convenience only: unreadable storage,
// or a store the server no longer lists for them, falls back to the server's default.
const storeKey = (viewer: string | undefined) => `featherbase.sales-target.store.${viewer ?? ''}`
function rememberedStore(viewer: string | undefined): string | null {
  try {
    return localStorage.getItem(storeKey(viewer))
  } catch {
    return null
  }
}
function rememberStore(viewer: string | undefined, store: string | null) {
  try {
    if (store) localStorage.setItem(storeKey(viewer), store)
    else localStorage.removeItem(storeKey(viewer))
  } catch {
    /* storage blocked: the choice lasts this visit only */
  }
}
const storeTitle = (s: StoreScope) => (s.store_name ? `${s.plant_code} — ${s.store_name}` : s.plant_code)

// Why the reader sees these rows, in the store's own words — leadership first.
// Exhaustive: a basis the server adds without a label here is a type error, not a silent omission.
const BASIS_LABEL: Record<ScopeBasis, string> = {
  store_manager: 'Store Manager',
  department_manager: 'Department Manager',
  team_leader: 'Team Leader',
  section_staff: 'Section staff',
  assignment: 'Assigned subcategories',
}

type Embed =
  | { kind: 'loading' }
  | { kind: 'frame'; src: string }
  | { kind: 'no-assignment' }
  | { kind: 'not-configured' }
  | { kind: 'no-access' }
  // #500: no message — the reader is told in plain words; the detail is in the server log.
  | { kind: 'error' }

// The pre-generated read: the same numbers as the Dive, served from the dataset
// snapshot instead of MotherDuck. It lands in milliseconds, so it paints while
// the embed session is still being minted — the whole point of the snapshot.
interface ReportRow {
  code: string
  subcategory: string
  section: string | null
  target: number | null
  actual: number | null
  gap: number | null
  achievement: number | null
  missingActual: boolean
  /** #4344: ₹0 target and ₹0 sales this period — hidden unless the reader asks for them. */
  noTargetNoSale?: boolean
}
interface Report {
  source: 'snapshot' | 'live'
  source_as_of: string | null
  generated_at: string | null
  store_name: string | null
  data_through: string | null
  cutoff_early: boolean
  no_data_yet?: boolean
  targets_unavailable?: boolean
  rows: ReportRow[]
  sections?: (Totals & { section: string | null })[]
  total: Totals
}
interface Totals {
  target: number | null
  actual: number | null
  gap: number | null
  achievement: number | null
  missing: number
  no_target_no_sale?: number
  n: number
}
type Pre =
  | { kind: 'loading' }
  | { kind: 'ready'; report: Report; ms: number }
  | { kind: 'no-assignment' }
  // #500: no message, as for the live report's card; a server-side failure is in the server log.
  | { kind: 'error' }

// ISO date -> DD-Mon-YYYY (identity chrome only; the report's own dates are the Dive's).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}

// The server orders rows Section by Section and computes each Section's subtotal;
// the page only slices. Titles appear once any row carries a Section.
function sectionGroups(report: Report): { section: string | null; titled: boolean; total: Totals; rows: ReportRow[] }[] {
  const subtotals = report.sections ?? []
  const titled = report.rows.some((r) => r.section != null)
  if (!titled || !subtotals.length) return [{ section: null, titled: false, total: report.total, rows: report.rows }]
  return subtotals.map(({ section, ...total }) => ({
    section,
    titled: true,
    total,
    rows: report.rows.filter((r) => (r.section ?? null) === section),
  }))
}

// #4344: a Section map lists every group a Section could sell — Food Court lists all of them —
// while a store trades a few. Groups with ₹0 target and ₹0 sales are hidden by default; they add
// ₹0, so every subtotal reads the same either way. Only the count of rows shown changes.
function shownCount(t: Totals, showAll: boolean): number {
  return showAll ? t.n : t.n - (t.no_target_no_sale ?? 0)
}

function QuickTable({ collapsed, refreshedAt, children }: {
  collapsed: boolean
  refreshedAt: string | null
  children: React.ReactNode
}) {
  if (!collapsed) return <>{children}</>
  return (
    <details className="mb-3" data-testid="snapshot-quick">
      <summary className="cursor-pointer text-xs text-ink-muted">
        Quick table from the cache{refreshedAt ? ` · refreshed ${fmtInstantIST(refreshedAt)}` : ''} — the live
        report below is current
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}

// Every identity call bumps this; a response whose number is no longer current
// belongs to an earlier opening (or an earlier account) and is dropped.
let openingSeq = 0

// #489: the signed-in person's theme choice outlives the bar's toggle.
export function SalesTargetPage() {
  return (
    <ThemeChoiceProvider>
      <SalesTargetReport />
    </ThemeChoiceProvider>
  )
}

function SalesTargetReport() {
  const user = getSessionUser()
  const [me, setMe] = useState<Me | null>(null)
  const [embed, setEmbed] = useState<Embed>({ kind: 'loading' })
  const [pre, setPre] = useState<Pre>({ kind: 'loading' })
  const [showNoTargetNoSale, setShowNoTargetNoSale] = useState(false)
  // #500: one retry, shared by every failing card (the live report's and the cached numbers'). A
  // press re-runs only what failed — the identity call, the cached read, the live report, or both
  // reads — without a page reload, so a working live report is never reopened to fix the cache.
  // While it runs every failing card stays up with a busy Try again, so nothing can be pressed
  // twice; it settles once each read it re-ran has answered, success or failure, so no card is
  // left stuck. `embedAt`/`preAt` are the states at the press: a new state object is an answer.
  interface Retry { embed: boolean; pre: boolean; embedAt: Embed; preAt: Pre }
  const [identityAttempt, setIdentityAttempt] = useState(0)
  const [openingAttempt, setOpeningAttempt] = useState(0)
  const [retrying, setRetrying] = useState<Retry | null>(null)
  const retryingRef = useRef<Retry | null>(null)
  retryingRef.current = retrying
  // Which reads the next opening re-runs; read once by that opening, so a later one (a store
  // fallback) is a full opening again.
  const retryPartsRef = useRef<{ embed: boolean; pre: boolean } | null>(null)
  // #564: the request in flight for each half of the page. A Try again that re-runs one half
  // replaces only that half's, so the other half, still opening, is never cancelled.
  const halvesRef = useRef<{ pre: AbortController | null; embed: AbortController | null }>({ pre: null, embed: null })
  useEffect(() => {
    const r = retrying
    if (!r) return
    const answered = (!r.embed || embed !== r.embedAt) && (!r.pre || pre !== r.preAt)
    if (answered || embed.kind === 'no-access') setRetrying(null)
  }, [embed, pre, retrying])

  const [store, setStore] = useState<string | null>(null)
  // Said once when a store the reader had open is no longer theirs and the report fell back (#409).
  const [storeNotice, setStoreNotice] = useState<string | null>(null)

  // Who the reader is and which stores they have — once per account.
  useEffect(() => {
    const seq = ++openingSeq
    const controller = new AbortController()
    const current = () => seq === openingSeq && !controller.signal.aborted
    ;(async () => {
      try {
        const identity = await api.get<Me>('/api/sales_target/me')
        if (!current()) return
        const remembered = rememberedStore(user?.row_id)
        setStore(identity.stores.some((s) => s.plant_code === remembered) ? remembered : identity.default_store)
        setMe(identity)
      } catch (err) {
        if (!current()) return
        // 403 = the viewer role is not theirs (or was taken away): say so as a sentence, not as the API's words (#404).
        if (err instanceof ApiError && err.status === 403) setEmbed({ kind: 'no-access' })
        else setEmbed({ kind: 'error' })
      }
    })()
    return () => controller.abort()
  }, [user?.row_id, identityAttempt])

  // One opening per store: the cached table and a fresh embed session, for the store on show.
  useEffect(() => {
    if (!me) return
    // A new account (the identity call bumps the number) drops this opening's answers.
    const seq = openingSeq
    const current = (signal: AbortSignal) => seq === openingSeq && !signal.aborted
    const parts = retryPartsRef.current
    retryPartsRef.current = null
    const halves = halvesRef.current
    const start = (half: 'pre' | 'embed') => {
      halves[half]?.abort()
      halves[half] = new AbortController()
      return halves[half].signal
    }
    const preSignal = !parts || parts.pre ? start('pre') : null
    const embedSignal = !parts || parts.embed ? start('embed') : null
    if (!parts) {
      setPre({ kind: 'loading' })
      setEmbed({ kind: 'loading' })
    }
    // Named only when there is a choice to make; the server re-checks it against the reader's own stores.
    const query = store && me.stores.length > 1 ? `?store=${encodeURIComponent(store)}` : ''
    // A 403 means the role was taken away OR the store named is no longer theirs. Ask /me which:
    // only /me itself refusing is "no access"; a store that dropped off the list falls back to
    // the default store with a note. Once per opening, though both calls may answer 403.
    let forbidden = false
    const onForbidden = async (signal: AbortSignal) => {
      if (forbidden) return
      forbidden = true
      try {
        const fresh = await api.get<Me>('/api/sales_target/me')
        if (!current(signal)) return
        const lost = query && store ? me.stores.find((s) => s.plant_code === store) : undefined
        if (lost && !fresh.stores.some((s) => s.plant_code === lost.plant_code)) {
          rememberStore(user?.row_id, null)
          setStoreNotice(`${storeTitle(lost)} is no longer assigned to you, so your report opened on your default store.`)
          setStore(fresh.default_store)
          setMe(fresh)
          return
        }
        setEmbed({ kind: 'error' })
      } catch (err) {
        if (!current(signal)) return
        if (err instanceof ApiError && err.status === 403) setEmbed({ kind: 'no-access' })
        else setEmbed({ kind: 'error' })
      }
    }
    ;(async () => {
      try {
        // Deliberately NOT awaited before the embed call: the snapshot read is
        // the fast path and must not queue behind a session mint.
        if (preSignal) void (async () => {
          const t0 = performance.now()
          try {
            const res = await fetch(`/api/sales_target/report${query}`, {
              headers: { authorization: `Bearer ${getToken() ?? ''}` },
              signal: preSignal,
            })
            const body = (await res.json().catch(
              /* istanbul ignore next -- a body that is not JSON comes only from something between the browser and the server (a proxy's error page); the server answers JSON on every path */
              () => ({}),
            )) as Report & { no_assignment?: boolean }
            const ms = performance.now() - t0
            if (!current(preSignal)) return
            if (res.status === 403) void onForbidden(preSignal) // never a red "Numbers unavailable"
            else if (body.no_assignment) setPre({ kind: 'no-assignment' })
            else if (res.ok) setPre({ kind: 'ready', report: body, ms })
            else setPre({ kind: 'error' })
          } catch {
            // A client-side fetch failure: nothing reached the server, so nothing is logged.
            if (!current(preSignal)) return
            setPre({ kind: 'error' })
          }
        })()

        // A retry of the cached numbers alone leaves a working live report where it is.
        if (!embedSignal) return

        const res = await fetch(`/api/sales_target/embed_session${query}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${getToken() ?? ''}` },
          signal: embedSignal,
        })
        const body = (await res.json().catch(
          /* istanbul ignore next -- a body that is not JSON comes only from something between the browser and the server (a proxy's error page); the server answers JSON on every path */
          () => ({}),
        )) as {
          session?: string
          no_assignment?: boolean
          not_configured?: boolean
        }
        if (!current(embedSignal)) return
        if (res.status === 401) {
          clearSession()
          window.location.href = '/featherbase/login'
          return
        }
        // Role taken away mid-session (the same plain card as at the start, #404), or the store is no longer theirs.
        if (res.status === 403) void onForbidden(embedSignal)
        else if (body.no_assignment) setEmbed({ kind: 'no-assignment' })
        else if (body.not_configured) setEmbed({ kind: 'not-configured' })
        else if (res.ok && typeof body.session === 'string')
          setEmbed({ kind: 'frame', src: `${me.embed_origin}/sandbox/#session=${encodeURIComponent(body.session)}` })
        else setEmbed({ kind: 'error' })
      } catch (err) {
        if (!embedSignal || !current(embedSignal)) return
        setEmbed({ kind: 'error' })
      }
    })()
    // Leaving the page, or a new store or account, cancels both halves; a Try again replaces
    // only the halves it re-runs (above).
    return () => {
      if (retryPartsRef.current) return
      halves.pre?.abort()
      halves.embed?.abort()
    }
  }, [me, store, openingAttempt])

  function tryAgain() {
    if (retryingRef.current) return
    // No identity yet: the identity call is what failed, and only the live report's card shows.
    const parts = me ? { embed: embed.kind === 'error', pre: pre.kind === 'error' } : { embed: true, pre: false }
    const r = { ...parts, embedAt: embed, preAt: pre }
    retryingRef.current = r
    setRetrying(r)
    if (me) {
      retryPartsRef.current = parts
      setOpeningAttempt((n) => n + 1)
    } else setIdentityAttempt((n) => n + 1)
  }

  function switchStore(next: string) {
    rememberStore(user?.row_id, next)
    setStoreNotice(null)
    setStore(next)
  }

  // Signing out is the shared top bar's (#489). Leaving the page drops this
  // opening: each effect's cleanup aborts its own requests, so nothing still
  // in flight renders after the account changes.

  // #3783: when the assignment was derived from the Store Sections maps, name the Sections —
  // that is the fact the store maintains, and what a reader recognises.
  const scope = me?.stores.find((s) => s.plant_code === store) ?? null
  const sections = scope?.sections ?? []
  const storeName = scope ? storeTitle(scope) : 'no store assigned'
  // Up to three Sections are named; more are counted, with the list one tap or key press away (a
  // native disclosure, so phones and keyboards reach it) — a Store Manager runs every Section,
  // and 57 names bury the figures (#3783).
  const wholeStore = scope?.scope_basis.includes('store_manager') ?? false
  const sectionLabel = sections.length <= 3 ? sections.join(' · ') : `${wholeStore ? 'Whole store · ' : ''}${sections.length} Sections`
  const period = me ? `${fmtDate(me.period_start)} to ${fmtDate(me.period_end)}` : ''
  const basis = scope?.scope_basis ?? []
  const basisLine = SCOPE_BASES.filter((b) => basis.includes(b)).map((b) => BASIS_LABEL[b]).join(' · ')

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* #489: the shared top bar. The identity line and the store switcher
          sit below it, inside the page (Stage B moves the switcher into the
          bar as a declared control). */}
      <TopBar home="feather_dash" />
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-3" data-testid="report-identity">
        <div className="flex min-w-0 items-center gap-3">
          <div>
            {/* Polite live region: a store switch is announced, not only repainted. */}
            <div className="text-sm font-semibold text-ink" data-testid="identity" aria-live="polite">
              {me ? (
                <>
                  {me.display_name} · {storeName}
                  {sections.length > 0 && sections.length <= 3 && <>{' · '}{sectionLabel}</>}
                  {sections.length > 3 && (
                    <>
                      {' · '}
                      <details data-testid="identity-sections" className="inline-block align-top">
                        <summary className="cursor-pointer underline decoration-dotted">{sectionLabel}</summary>
                        <span data-testid="identity-section-list" className="block font-normal text-ink-muted">
                          {sections.join(' · ')}
                        </span>
                      </details>
                    </>
                  )}
                  {' · '}
                  {period}
                </>
              ) : (
                embed.kind === 'loading' ? 'Opening your report…' : 'Sales target report'
              )}
            </div>
            <p className="text-xs text-ink-muted" data-testid="identity-sub">
              {me ? `${me.username ? `Signed in as ${me.username} · ` : ''}${basisLine ? `${basisLine} · ` : ''}Sales before tax, net of returns` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* #409: a reader with several stores reads one at a time; the choice is theirs to switch. */}
          {me && me.stores.length > 1 && store && (
            <Select
              aria-label="Store"
              data-testid="store-switcher"
              className="w-auto"
              value={store}
              onChange={(e) => switchStore(e.target.value)}
            >
              {me.stores.map((s) => (
                <option key={s.plant_code} value={s.plant_code}>
                  {storeTitle(s)}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      <main className="flex flex-1 flex-col p-3">
      {storeNotice && (
        <div className="mb-3" data-testid="store-notice">
          <Notice>{storeNotice}</Notice>
        </div>
      )}
      {/* Pre-generated read, above the live Dive. Same numbers, served from the
          dataset snapshot; it paints while the embed session is still being minted. */}
      {/* One report, not two: when the live Dive is on the page it IS the report, and the cached
          table folds away behind a line that says how old it is. The cache is refreshed a few
          times a day while the warehouse loads sales intraday, so shown side by side the two
          disagreed under the same "data as of" date (02-Oct-2026). Open by default whenever the
          live report is not there — not configured, failed, or still opening — and whenever the
          cached read itself failed, so its card and Try again are not folded out of sight (#503). */}
      {/* Without an identity nothing was read for anyone: no cached table to wait for. */}
      {me && embed.kind !== 'no-access' && (
      <QuickTable collapsed={embed.kind === 'frame' && pre.kind !== 'error'} refreshedAt={pre.kind === 'ready' ? pre.report.generated_at : null}>
      <section className={cardClasses('mb-3 overflow-x-auto p-0')} data-testid="snapshot-report" data-state={pre.kind}>
        {pre.kind === 'loading' && (
          <p className="p-4 text-sm text-ink-muted">Reading your numbers…</p>
        )}
        {pre.kind === 'no-assignment' && (
          <p className="p-4 text-sm text-ink-muted">
            No store–subcategory assignment, so there are no numbers to show.
          </p>
        )}
        {pre.kind === 'error' && (
          <div className="p-4 text-sm" data-testid="snapshot-error">
            <p className="font-medium text-negative">Numbers unavailable</p>
            <p className="mt-1 text-ink-muted">The numbers couldn't load right now. Try again in a few minutes.</p>
            <Button variant="secondary" className="mt-3" loading={retrying !== null} onClick={tryAgain}>
              Try again
            </Button>
          </div>
        )}
        {pre.kind === 'ready' && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-2">
              <p className="text-sm font-semibold text-ink">
                {pre.report.store_name ?? 'Store'} · month to date
              </p>
              <p className="text-xs text-ink-muted" data-testid="snapshot-freshness">
                {/* Two different facts, both shown on purpose. "Data as of" is the
                    WAREHOUSE's own cutoff — is this figure complete. "Refreshed" is when
                    we last materialised it — how stale is this page. A snapshot built
                    minutes ago from three-day-old data is fresh by one and stale by the
                    other, so collapsing them into one number would hide exactly the case
                    a reader needs to catch. */}
                Data as of {fmtDay(pre.report.source_as_of)}
                {pre.report.cutoff_early ? ` (period ends later; counted through ${fmtDay(pre.report.data_through)})` : ''}
                {pre.report.generated_at ? (
                  <> · refreshed <span data-testid="snapshot-generated">{fmtInstantIST(pre.report.generated_at)}</span></>
                ) : null}
                {' · '}
                <span data-testid="snapshot-timing">
                  {pre.report.source === 'snapshot' ? 'snapshot' : 'live'} · {Math.round(pre.ms)} ms
                </span>
              </p>
            </div>
            {(pre.report.total.no_target_no_sale ?? 0) > 0 && (
              <label className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  data-testid="show-no-target-no-sale"
                  checked={showNoTargetNoSale}
                  onChange={(e) => setShowNoTargetNoSale(e.target.checked)}
                />
                Show subcategories with no target or sales ({pre.report.total.no_target_no_sale})
              </label>
            )}
            {pre.report.targets_unavailable && !pre.report.no_data_yet && (
              <p className="border-b border-border px-4 py-2 text-sm text-ink" data-testid="snapshot-targets-unavailable">
                Targets are not available right now, so sales are shown without them. A blank target is not a
                target of zero.
              </p>
            )}
            {pre.report.no_data_yet && (
              <p className="border-b border-border px-4 py-2 text-sm text-ink" data-testid="snapshot-no-data-yet">
                No sales recorded for this month yet — the warehouse has data through {fmtDay(pre.report.source_as_of)}.
                The figures below fill in after the morning load. This is not a sales figure of zero.
              </p>
            )}
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2 font-medium">Subcategory</th>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 text-right font-medium">Target</th>
                  <th className="px-4 py-2 text-right font-medium">Actual</th>
                  <th className="px-4 py-2 text-right font-medium">Above / below</th>
                  <th className="px-4 py-2 text-right font-medium">Achievement</th>
                </tr>
              </thead>
              {/* One tbody per Section: a heading row carrying the Section's subtotal, then its
                  subcategories. A report with no Section map is one untitled group. */}
              {sectionGroups(pre.report).map((g) => (
                <tbody key={g.section ?? '(unmapped)'} data-testid="snapshot-section" data-section={g.section ?? ''}>
                  {g.titled && (
                    <tr className="border-t-2 border-border bg-canvas font-semibold" data-testid="snapshot-section-total">
                      <td className="px-4 py-2 text-ink" colSpan={2}>
                        {g.section ?? 'Not mapped to a Section'} · {shownCount(g.total, showNoTargetNoSale)} subcategor{shownCount(g.total, showNoTargetNoSale) === 1 ? 'y' : 'ies'}
                        {!showNoTargetNoSale && (g.total.no_target_no_sale ?? 0) > 0 && (
                          <span className="font-normal text-ink-muted" data-testid="snapshot-section-hidden">
                            {' '}· {g.total.no_target_no_sale} with no target or sales hidden
                          </span>
                        )}
                        {g.total.missing > 0 && (
                          <span className="font-normal text-ink-muted" data-testid="snapshot-section-missing">
                            {' '}· {g.total.missing} without actuals
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtExact(g.total.target)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtExact(g.total.actual)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${g.total.gap != null && g.total.gap < 0 ? 'text-negative' : ''}`}>
                        {fmtSigned(g.total.gap)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtPct(g.total.achievement)}</td>
                    </tr>
                  )}
                  {g.rows.filter((r) => showNoTargetNoSale || !r.noTargetNoSale).map((r) => (
                    <tr key={r.code} className={`border-t border-border ${r.noTargetNoSale ? 'text-ink-muted' : ''}`} data-testid="snapshot-row" data-code={r.code}>
                      <td className="px-4 py-2 text-ink">{r.subcategory}</td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-muted">{r.code}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtExact(r.target)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtExact(r.actual)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${r.gap != null && r.gap < 0 ? 'text-negative' : ''}`}>
                        {fmtSigned(r.gap)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtPct(r.achievement)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr className="border-t-2 border-border font-semibold" data-testid="snapshot-total">
                  <td className="px-4 py-2" colSpan={2}>
                    Total · {shownCount(pre.report.total, showNoTargetNoSale)} subcategor{shownCount(pre.report.total, showNoTargetNoSale) === 1 ? 'y' : 'ies'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtExact(pre.report.total.target)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtExact(pre.report.total.actual)}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${pre.report.total.gap != null && pre.report.total.gap < 0 ? 'text-negative' : ''}`}>
                    {fmtSigned(pre.report.total.gap)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtPct(pre.report.total.achievement)}</td>
                </tr>
              </tfoot>
            </table>
            {pre.report.total.missing > 0 && (
              <p className="px-4 py-2 text-xs text-ink-muted" data-testid="snapshot-missing">
                {/* A day never observed is missing, never zero — the two must not look alike. */}
                {pre.report.total.missing} subcategor{pre.report.total.missing === 1 ? 'y has' : 'ies have'} no actuals
                in this period and show “—” rather than ₹0.00.
              </p>
            )}
          </>
        )}
      </section>
      </QuickTable>
      )}

        {embed.kind === 'frame' ? (
          <iframe
            data-testid="report-frame"
            title="Sales target vs actual report"
            sandbox="allow-scripts allow-same-origin"
            src={embed.src}
            className="min-h-[70vh] w-full flex-1 rounded-[var(--radius-card)] border border-border bg-surface"
          />
        ) : (
          <div className={cardClasses('mx-auto mt-6 max-w-xl p-5 text-sm')} data-testid="embed-state" data-state={embed.kind}>
            {embed.kind === 'loading' && <p className="text-ink-muted">Opening your report…</p>}
            {embed.kind === 'no-assignment' && (
              <>
                <p className="font-medium text-ink">No subcategories assigned</p>
                <p className="mt-1 text-ink-muted">
                  This account has no store–subcategory assignment. Ask your manager to assign your subcategories.
                </p>
              </>
            )}
            {embed.kind === 'no-access' && (
              <>
                <p className="font-medium text-ink">You don't have access to this report</p>
                <p className="mt-1 text-ink-muted">
                  Ask your manager or administrator to give you access.
                </p>
              </>
            )}
            {embed.kind === 'not-configured' && (
              // Quiet, not red: this deployment simply has no live Dive. The numbers
              // above came from the snapshot and are unaffected.
              <p className="text-ink-muted">
                The live MotherDuck report is not configured on this deployment. The figures above
                are served from the dataset snapshot and are unaffected.
              </p>
            )}
            {embed.kind === 'error' && (
              <>
                <p className="font-medium text-negative">Report unavailable</p>
                <p className="mt-1 text-ink-muted">The report couldn't load right now. Try again in a few minutes.</p>
                <Button variant="secondary" className="mt-3" loading={retrying !== null} onClick={tryAgain}>
                  Try again
                </Button>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
