import { useEffect, useRef, useState } from 'react'
import { Notice, Select, buttonClasses } from '../components/ui'
import { useNavigate } from '@tanstack/react-router'
import { ApiError, SIGN_OUT_INCOMPLETE, api, clearSession, getSessionUser, getToken, signOut } from '../lib/api'
import { Logo } from '../components/Logo'
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
  | { kind: 'error'; message: string }

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
  missingTarget: boolean
}
interface Report {
  source: 'snapshot' | 'live'
  source_as_of: string | null
  generated_at: string | null
  store_name: string | null
  data_through: string | null
  cutoff_early: boolean
  no_data_yet?: boolean
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
  n: number
}
type Pre =
  | { kind: 'loading' }
  | { kind: 'ready'; report: Report; ms: number }
  | { kind: 'no-assignment' }
  | { kind: 'error'; message: string }

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

function QuickTable({ collapsed, refreshedAt, children }: {
  collapsed: boolean
  refreshedAt: string | null
  children: React.ReactNode
}) {
  if (!collapsed) return <>{children}</>
  return (
    <details className="mb-3" data-testid="snapshot-quick">
      <summary className="cursor-pointer text-xs text-[var(--color-ink-muted)]">
        Quick table from the cache{refreshedAt ? ` · refreshed ${fmtInstantIST(refreshedAt)}` : ''} — the live
        report below is current
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}

// Every opening bumps this; a response whose number is no longer current
// belongs to an earlier opening (or an earlier account) and is dropped.
let openingSeq = 0

export function SalesTargetPage() {
  const navigate = useNavigate()
  const user = getSessionUser()
  const [me, setMe] = useState<Me | null>(null)
  const [embed, setEmbed] = useState<Embed>({ kind: 'loading' })
  const [pre, setPre] = useState<Pre>({ kind: 'loading' })
  const abortRef = useRef<AbortController | null>(null)

  const [store, setStore] = useState<string | null>(null)
  // Said once when a store the reader had open is no longer theirs and the report fell back (#409).
  const [storeNotice, setStoreNotice] = useState<string | null>(null)

  // Who the reader is and which stores they have — once per account.
  useEffect(() => {
    const seq = ++openingSeq
    const controller = new AbortController()
    abortRef.current = controller
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
        else setEmbed({ kind: 'error', message: err instanceof Error ? err.message : 'network error' })
      }
    })()
    return () => controller.abort()
  }, [user?.row_id])

  // One opening per store: the cached table and a fresh embed session, for the store on show.
  useEffect(() => {
    if (!me) return
    const seq = ++openingSeq
    const controller = new AbortController()
    abortRef.current = controller
    const current = () => seq === openingSeq && !controller.signal.aborted
    setPre({ kind: 'loading' })
    setEmbed({ kind: 'loading' })
    // Named only when there is a choice to make; the server re-checks it against the reader's own stores.
    const query = store && me.stores.length > 1 ? `?store=${encodeURIComponent(store)}` : ''
    // A 403 means the role was taken away OR the store named is no longer theirs. Ask /me which:
    // only /me itself refusing is "no access"; a store that dropped off the list falls back to
    // the default store with a note. Once per opening, though both calls may answer 403.
    let forbidden = false
    const onForbidden = async () => {
      if (forbidden) return
      forbidden = true
      try {
        const fresh = await api.get<Me>('/api/sales_target/me')
        if (!current()) return
        const lost = query && store ? me.stores.find((s) => s.plant_code === store) : undefined
        if (lost && !fresh.stores.some((s) => s.plant_code === lost.plant_code)) {
          rememberStore(user?.row_id, null)
          setStoreNotice(`${storeTitle(lost)} is no longer assigned to you, so your report opened on your default store.`)
          setStore(fresh.default_store)
          setMe(fresh)
          return
        }
        setEmbed({ kind: 'error', message: 'HTTP 403' })
      } catch (err) {
        if (!current()) return
        if (err instanceof ApiError && err.status === 403) setEmbed({ kind: 'no-access' })
        else setEmbed({ kind: 'error', message: err instanceof Error ? err.message : 'network error' })
      }
    }
    ;(async () => {
      try {
        // Deliberately NOT awaited before the embed call: the snapshot read is
        // the fast path and must not queue behind a session mint.
        void (async () => {
          const t0 = performance.now()
          try {
            const res = await fetch(`/api/sales_target/report${query}`, {
              headers: { authorization: `Bearer ${getToken() ?? ''}` },
              signal: controller.signal,
            })
            const body = (await res.json().catch(() => ({}))) as Report & { no_assignment?: boolean }
            const ms = performance.now() - t0
            if (!current()) return
            if (res.status === 403) void onForbidden() // never a red "Numbers unavailable"
            else if (body.no_assignment) setPre({ kind: 'no-assignment' })
            else if (res.ok) setPre({ kind: 'ready', report: body, ms })
            else setPre({ kind: 'error', message: `HTTP ${res.status}` })
          } catch (err) {
            if (!current()) return
            setPre({ kind: 'error', message: err instanceof Error ? err.message : 'network error' })
          }
        })()

        const res = await fetch(`/api/sales_target/embed_session${query}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${getToken() ?? ''}` },
          signal: controller.signal,
        })
        const body = (await res.json().catch(() => ({}))) as {
          session?: string
          no_assignment?: boolean
          not_configured?: boolean
          error?: { message?: string; upstream_status?: number }
        }
        if (!current()) return
        if (res.status === 401) {
          clearSession()
          window.location.href = '/featherbase/login'
          return
        }
        // Role taken away mid-session (the same plain card as at the start, #404), or the store is no longer theirs.
        if (res.status === 403) void onForbidden()
        else if (body.no_assignment) setEmbed({ kind: 'no-assignment' })
        else if (body.not_configured) setEmbed({ kind: 'not-configured' })
        else if (res.ok && typeof body.session === 'string')
          setEmbed({ kind: 'frame', src: `${me.embed_origin}/sandbox/#session=${encodeURIComponent(body.session)}` })
        else setEmbed({ kind: 'error', message: body.error?.message ?? `HTTP ${res.status}` })
      } catch (err) {
        if (!current()) return
        setEmbed({ kind: 'error', message: err instanceof Error ? err.message : 'network error' })
      }
    })()
    return () => controller.abort()
  }, [me, store])

  function switchStore(next: string) {
    rememberStore(user?.row_id, next)
    setStoreNotice(null)
    setStore(next)
  }

  async function logout() {
    // Expire the cookie and end the session before local state goes. #411: a
    // sign-out the server could not complete is said, and the page stays.
    if (!(await signOut())) {
      window.alert(SIGN_OUT_INCOMPLETE)
      return
    }
    // Drop this opening so nothing still in flight renders after the account
    // changes.
    openingSeq++
    abortRef.current?.abort()
    clearSession()
    await navigate({ to: '/featherbase/login' })
  }

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
    <div className="flex min-h-screen flex-col bg-[var(--color-canvas)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <div className="flex items-center gap-3">
          <Logo className="h-7 w-7 rounded-md" />
          <div>
            {/* Polite live region: a store switch is announced, not only repainted. */}
            <div className="text-sm font-semibold text-[var(--color-ink)]" data-testid="identity" aria-live="polite">
              {me ? (
                <>
                  {me.display_name} · {storeName}
                  {sections.length > 0 && sections.length <= 3 && <>{' · '}{sectionLabel}</>}
                  {sections.length > 3 && (
                    <>
                      {' · '}
                      <details data-testid="identity-sections" className="inline-block align-top">
                        <summary className="cursor-pointer underline decoration-dotted">{sectionLabel}</summary>
                        <span data-testid="identity-section-list" className="block font-normal text-[var(--color-ink-muted)]">
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
            <p className="text-xs text-[var(--color-ink-muted)]" data-testid="identity-sub">
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
          {/* person-identities: a Team Leader reaches their sign-in methods
              (e.g. to link Google) from the report they land on. */}
          <a href="/featherbase/admin/sign-in-methods" className={buttonClasses()} data-testid="sign-in-methods-link">
            Sign-in methods
          </a>
          <button type="button" className="fc-btn" data-testid="logout" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

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
          live report is not there — not configured, failed, or still opening. */}
      {/* Without an identity nothing was read for anyone: no cached table to wait for. */}
      {me && embed.kind !== 'no-access' && (
      <QuickTable collapsed={embed.kind === 'frame'} refreshedAt={pre.kind === 'ready' ? pre.report.generated_at : null}>
      <section className="fc-card mb-3 overflow-x-auto p-0" data-testid="snapshot-report" data-state={pre.kind}>
        {pre.kind === 'loading' && (
          <p className="p-4 text-sm text-[var(--color-ink-muted)]">Reading your numbers…</p>
        )}
        {pre.kind === 'no-assignment' && (
          <p className="p-4 text-sm text-[var(--color-ink-muted)]">
            No store–subcategory assignment, so there are no numbers to show.
          </p>
        )}
        {pre.kind === 'error' && (
          <p className="p-4 text-sm text-[var(--color-danger)]" data-testid="snapshot-error">
            Numbers unavailable ({pre.message}). This is not a sales figure.
          </p>
        )}
        {pre.kind === 'ready' && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {pre.report.store_name ?? 'Store'} · month to date
              </p>
              <p className="text-xs text-[var(--color-ink-muted)]" data-testid="snapshot-freshness">
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
            {pre.report.no_data_yet && (
              <p className="border-b border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-ink)]" data-testid="snapshot-no-data-yet">
                No sales recorded for this month yet — the warehouse has data through {fmtDay(pre.report.source_as_of)}.
                The figures below fill in after the morning load. This is not a sales figure of zero.
              </p>
            )}
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
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
                    <tr className="border-t-2 border-[var(--color-border)] bg-[var(--color-canvas)] font-semibold" data-testid="snapshot-section-total">
                      <td className="px-4 py-2 text-[var(--color-ink)]" colSpan={2}>
                        {g.section ?? 'Not mapped to a Section'} · {g.total.n} subcategor{g.total.n === 1 ? 'y' : 'ies'}
                        {g.total.missing > 0 && (
                          <span className="font-normal text-[var(--color-ink-muted)]" data-testid="snapshot-section-missing">
                            {' '}· {g.total.missing} without actuals
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtExact(g.total.target)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtExact(g.total.actual)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${g.total.gap != null && g.total.gap < 0 ? 'text-[var(--color-danger)]' : ''}`}>
                        {fmtSigned(g.total.gap)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtPct(g.total.achievement)}</td>
                    </tr>
                  )}
                  {g.rows.map((r) => (
                    <tr key={r.code} className="border-t border-[var(--color-border)]" data-testid="snapshot-row" data-code={r.code}>
                      <td className="px-4 py-2 text-[var(--color-ink)]">{r.subcategory}</td>
                      <td className="px-4 py-2 font-mono text-xs text-[var(--color-ink-muted)]">{r.code}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtExact(r.target)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtExact(r.actual)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${r.gap != null && r.gap < 0 ? 'text-[var(--color-danger)]' : ''}`}>
                        {fmtSigned(r.gap)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtPct(r.achievement)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr className="border-t-2 border-[var(--color-border)] font-semibold" data-testid="snapshot-total">
                  <td className="px-4 py-2" colSpan={2}>
                    Total · {pre.report.total.n} subcategor{pre.report.total.n === 1 ? 'y' : 'ies'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtExact(pre.report.total.target)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtExact(pre.report.total.actual)}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${pre.report.total.gap != null && pre.report.total.gap < 0 ? 'text-[var(--color-danger)]' : ''}`}>
                    {fmtSigned(pre.report.total.gap)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtPct(pre.report.total.achievement)}</td>
                </tr>
              </tfoot>
            </table>
            {pre.report.total.missing > 0 && (
              <p className="px-4 py-2 text-xs text-[var(--color-ink-muted)]" data-testid="snapshot-missing">
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
            className="min-h-[70vh] w-full flex-1 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]"
          />
        ) : (
          <div className="fc-card mx-auto mt-6 max-w-xl p-5 text-sm" data-testid="embed-state" data-state={embed.kind}>
            {embed.kind === 'loading' && <p className="text-[var(--color-ink-muted)]">Opening your report…</p>}
            {embed.kind === 'no-assignment' && (
              <>
                <p className="font-medium text-[var(--color-ink)]">No subcategories assigned</p>
                <p className="mt-1 text-[var(--color-ink-muted)]">
                  This account has no store–subcategory assignment. Ask your manager to assign your subcategories.
                </p>
              </>
            )}
            {embed.kind === 'no-access' && (
              <>
                <p className="font-medium text-[var(--color-ink)]">You don't have access to this report</p>
                <p className="mt-1 text-[var(--color-ink-muted)]">
                  Ask your manager or administrator to give you access.
                </p>
              </>
            )}
            {embed.kind === 'not-configured' && (
              // Quiet, not red: this deployment simply has no live Dive. The numbers
              // above came from the snapshot and are unaffected.
              <p className="text-[var(--color-ink-muted)]">
                The live MotherDuck report is not configured on this deployment. The figures above
                are served from the dataset snapshot and are unaffected.
              </p>
            )}
            {embed.kind === 'error' && (
              <>
                <p className="font-medium text-[var(--color-danger)]">Report unavailable</p>
                <p className="mt-1 text-[var(--color-ink-muted)]">
                  The report session could not be created ({embed.message}). This is not a sales figure.
                </p>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
