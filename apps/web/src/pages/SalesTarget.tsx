import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api, clearSession, getSessionUser, getToken } from '../lib/api'
import { Logo } from '../components/Logo'

// #3755: the personalised sales-target report. The page holds no report
// logic — MotherDuck renders the Dive inside a sandboxed iframe. What the page
// owns: the identity chrome (who, which store, which period), one fresh
// embed-session request per opening, honest empty/error states that can never
// read as zero sales, and sign-out. The server decides the assignment and the
// embed origin; the browser chooses nothing.

interface Me {
  username: string
  display_name: string
  assignment: { plant_code: string; store_label: string | null; material_groups: string[] } | null
  period_start: string
  period_end: string
  embed_origin: string
}

type Embed =
  | { kind: 'loading' }
  | { kind: 'frame'; src: string }
  | { kind: 'no-assignment' }
  | { kind: 'error'; message: string }

// ISO date -> DD-Mon-YYYY (identity chrome only; the report's own dates are the Dive's).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}

// Every opening bumps this; a response whose number is no longer current
// belongs to an earlier opening (or an earlier account) and is dropped.
let openingSeq = 0

export function SalesTargetPage() {
  const navigate = useNavigate()
  const user = getSessionUser()
  const [me, setMe] = useState<Me | null>(null)
  const [embed, setEmbed] = useState<Embed>({ kind: 'loading' })
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
        const res = await fetch('/api/sales_target/embed_session', {
          method: 'POST',
          headers: { authorization: `Bearer ${getToken() ?? ''}` },
          signal: controller.signal,
        })
        const body = (await res.json().catch(() => ({}))) as {
          session?: string
          no_assignment?: boolean
          error?: { message?: string; upstream_status?: number }
        }
        if (!current()) return
        if (res.status === 401) {
          clearSession()
          window.location.href = '/login'
          return
        }
        if (body.no_assignment) setEmbed({ kind: 'no-assignment' })
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
    await navigate({ to: '/login' })
  }

  const store = me?.assignment
    ? `${me.assignment.plant_code} — ${me.assignment.store_label ?? ''}`.trim()
    : 'no store assigned'
  const period = me ? `${fmtDate(me.period_start)} to ${fmtDate(me.period_end)}` : ''

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-canvas)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <div className="flex items-center gap-3">
          <Logo className="h-7 w-7 rounded-md" />
          <div>
            <p className="text-sm font-semibold text-[var(--color-ink)]" data-testid="identity">
              {me ? `${me.display_name} · ${store} · ${period}` : 'Opening your report…'}
            </p>
            <p className="text-xs text-[var(--color-ink-muted)]" data-testid="identity-sub">
              {me ? `Signed in as ${me.username} · Sales before tax, net of returns` : ''}
            </p>
          </div>
        </div>
        <button type="button" className="fc-btn" data-testid="logout" onClick={() => void logout()}>
          Log out
        </button>
      </header>

      <main className="flex flex-1 flex-col p-3">
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
