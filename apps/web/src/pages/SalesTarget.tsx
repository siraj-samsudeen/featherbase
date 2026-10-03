import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api, clearSession, getSessionUser, getToken } from '../lib/api'
import { Logo } from '../components/Logo'
import { SCOPE_BASES, type ScopeBasis } from 'shared'
import { fmtDate as fmtDay, fmtExact, fmtInstantIST, fmtPct, fmtSigned } from '../lib/inr'

// #3755: the personalised sales-target report. The page holds no report
// logic — MotherDuck renders the Dive inside a sandboxed iframe. What the page
// owns: the identity chrome (who, which store, which period), one fresh
// embed-session request per opening, honest empty/error states that can never
// read as zero sales, and sign-out. The server decides the assignment and the
// embed origin; the browser chooses nothing.

interface Me {
  username: string
  display_name: string
  assignment: {
    plant_code: string
    store_label: string | null
    material_groups: string[]
    sections?: string[]
    scope_basis?: ScopeBasis[]
  } | null
  period_start: string
  period_end: string
  embed_origin: string
}

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

  useEffect(() => {
    const seq = ++openingSeq
    const controller = new AbortController()
    abortRef.current = controller
    const current = () => seq === openingSeq && !controller.signal.aborted
    ;(async () => {
      try {
        const identity = await api.get<Me>('/api/sales_target/me')
        if (!current()) return
        setMe(identity)

        // Deliberately NOT awaited before the embed call: the snapshot read is
        // the fast path and must not queue behind a session mint.
        void (async () => {
          const t0 = performance.now()
          try {
            const res = await fetch('/api/sales_target/report', {
              headers: { authorization: `Bearer ${getToken() ?? ''}` },
              signal: controller.signal,
            })
            const body = (await res.json().catch(() => ({}))) as Report & { no_assignment?: boolean }
            const ms = performance.now() - t0
            if (!current()) return
            if (body.no_assignment) setPre({ kind: 'no-assignment' })
            else if (res.ok) setPre({ kind: 'ready', report: body, ms })
            else setPre({ kind: 'error', message: `HTTP ${res.status}` })
          } catch (err) {
            if (!current()) return
            setPre({ kind: 'error', message: err instanceof Error ? err.message : 'network error' })
          }
        })()

        const res = await fetch('/api/sales_target/embed_session', {
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
        if (body.no_assignment) setEmbed({ kind: 'no-assignment' })
        else if (body.not_configured) setEmbed({ kind: 'not-configured' })
        else if (res.ok && typeof body.session === 'string')
          setEmbed({ kind: 'frame', src: `${identity.embed_origin}/sandbox/#session=${encodeURIComponent(body.session)}` })
        else setEmbed({ kind: 'error', message: body.error?.message ?? `HTTP ${res.status}` })
      } catch (err) {
        if (!current()) return
        setEmbed({ kind: 'error', message: err instanceof Error ? err.message : 'network error' })
      }
    })()
    return () => controller.abort()
  }, [user?.row_id])

  async function logout() {
    // Drop this opening first so nothing still in flight can render after
    // the account changes, then expire the cookie before local state goes.
    openingSeq++
    abortRef.current?.abort()
    await api.post('/api/logout', {}).catch(() => {})
    clearSession()
    await navigate({ to: '/featherbase/login' })
  }

  // #3783: when the assignment was derived from the Store Sections maps, name the Sections —
  // that is the fact the store maintains, and what a reader recognises.
  const sections = me?.assignment?.sections ?? []
  const storeName = me?.assignment
    ? me.assignment.store_label ? `${me.assignment.plant_code} — ${me.assignment.store_label}` : me.assignment.plant_code
    : 'no store assigned'
  // Up to three Sections are named; more are counted, with the list one hover away — a Store
  // Manager runs every Section, and 57 names bury the figures (#3783).
  const wholeStore = me?.assignment?.scope_basis?.includes('store_manager') ?? false
  const sectionLabel = sections.length <= 3 ? sections.join(' · ') : `${wholeStore ? 'Whole store · ' : ''}${sections.length} Sections`
  const period = me ? `${fmtDate(me.period_start)} to ${fmtDate(me.period_end)}` : ''
  const basis = me?.assignment?.scope_basis ?? []
  const basisLine = SCOPE_BASES.filter((b) => basis.includes(b)).map((b) => BASIS_LABEL[b]).join(' · ')

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-canvas)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <div className="flex items-center gap-3">
          <Logo className="h-7 w-7 rounded-md" />
          <div>
            <p className="text-sm font-semibold text-[var(--color-ink)]" data-testid="identity">
              {me ? (
                <>
                  {me.display_name} · {storeName}
                  {sectionLabel && (
                    <>
                      {' · '}
                      <span data-testid="identity-sections" title={sections.join(' · ')}>{sectionLabel}</span>
                    </>
                  )}
                  {' · '}
                  {period}
                </>
              ) : (
                'Opening your report…'
              )}
            </p>
            <p className="text-xs text-[var(--color-ink-muted)]" data-testid="identity-sub">
              {me ? `Signed in as ${me.username}${basisLine ? ` · ${basisLine}` : ''} · Sales before tax, net of returns` : ''}
            </p>
          </div>
        </div>
        <button type="button" className="fc-btn" data-testid="logout" onClick={() => void logout()}>
          Log out
        </button>
      </header>

      <main className="flex flex-1 flex-col p-3">
      {/* Pre-generated read, above the live Dive. Same numbers, served from the
          dataset snapshot; it paints while the embed session is still being minted. */}
      {/* One report, not two: when the live Dive is on the page it IS the report, and the cached
          table folds away behind a line that says how old it is. The cache is refreshed a few
          times a day while the warehouse loads sales intraday, so shown side by side the two
          disagreed under the same "data as of" date (02-Oct-2026). Open by default whenever the
          live report is not there — not configured, failed, or still opening. */}
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
