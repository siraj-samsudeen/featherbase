import { useEffect } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { adminPageTitle } from 'shared'
import { api } from '../lib/api'
import { fmtInstantIST } from '../lib/inr'
import { Button, Card, Notice, Skeleton, StatusPill, cx, type StatusTone } from '../components/ui'
import { ChevronRight } from '../components/ui/icons'

// Instance health (#465, design D8; spec instance-health). One page listing
// every check with its state, why it matters, how to fix it and its history,
// and the one-line banner every System Manager sees while a check fails.
// Both read GET /api/instance-health; the banner cannot be dismissed, and
// goes on its own once every check passes.

type Severity = 'error' | 'warning'

interface HistoryEntry {
  ok: boolean
  severity: Severity
  message: string
  from: string
  until: string | null
}

export interface HealthCheckView {
  key: string
  title: string
  ok: boolean
  severity: Severity
  message: string
  why: string
  fix: string | null
  since: string | null
  history: HistoryEntry[]
}

export interface InstanceHealthView {
  checks: HealthCheckView[]
  failing: number
  worst: Severity | null
  checked_at: string
}

export const INSTANCE_HEALTH_QUERY_KEY = ['instance-health'] as const
export const INSTANCE_HEALTH_PATH = '/featherbase/admin/instance-health'

/** The checks, asked again every minute and on every page change, so the
 *  banner goes soon after the cause is fixed. */
export function useInstanceHealth(enabled: boolean) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const query = useQuery({
    queryKey: INSTANCE_HEALTH_QUERY_KEY,
    queryFn: () => api.get<InstanceHealthView>('/api/instance-health'),
    enabled,
    refetchInterval: 60_000,
  })
  const { refetch } = query
  useEffect(() => {
    if (enabled) void refetch()
  }, [pathname, enabled, refetch])
  return query
}

export function problemsLine(n: number): string {
  return n === 1 ? '1 problem needs attention' : `${n} problems need attention`
}

/** The banner: System Managers only (the caller passes `enabled`), while a
 *  check fails. Red when any failing check is an error, amber otherwise. */
export function HealthBanner({ enabled }: { enabled: boolean }) {
  const health = useInstanceHealth(enabled)
  const data = health.data
  if (!enabled || !data || data.failing === 0) return null
  const error = data.worst === 'error'
  return (
    <div
      data-testid="health-banner"
      data-severity={data.worst}
      role="status"
      className={cx(
        'flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-0 px-3 text-sm font-medium',
        error ? 'bg-negative-tint text-negative' : 'bg-caution-tint text-caution',
      )}
    >
      <span className="py-1">{problemsLine(data.failing)}</span>
      <Link
        to={INSTANCE_HEALTH_PATH}
        className="inline-flex min-h-8 items-center underline underline-offset-2 max-sm:min-h-11"
      >
        Open instance health
      </Link>
    </div>
  )
}

const STATE: Record<'passing' | Severity, { label: string; tone: StatusTone }> = {
  passing: { label: 'Passing', tone: 'positive' },
  warning: { label: 'Warning', tone: 'caution' },
  error: { label: 'Failing', tone: 'negative' },
}

const stateOf = (ok: boolean, severity: Severity) => STATE[ok ? 'passing' : severity]

/** The Activity Log in the hour before a change and the 15 minutes after:
 *  what someone did that broke or fixed it. */
export function activityAround(at: string): string {
  const t = new Date(at).getTime()
  const filters = [
    ['created_at', '>=', new Date(t - 60 * 60_000).toISOString()],
    ['created_at', '<=', new Date(t + 15 * 60_000).toISOString()],
  ]
  return `/featherbase/admin/Activity%20Log?filters=${encodeURIComponent(JSON.stringify(filters))}`
}

function historyLine(h: HistoryEntry): string {
  const state = h.ok ? 'Passing' : h.severity === 'warning' ? 'Warning' : 'Failing'
  return h.until
    ? `${state} from ${fmtInstantIST(h.from)} to ${fmtInstantIST(h.until)}`
    : `${state} since ${fmtInstantIST(h.from)}`
}

/** A check's text with `commands` set as code. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 2
          ? <code key={i} className="rounded bg-subtle px-0.5 font-mono text-xs text-ink">{part.slice(1, -1)}</code>
          : part)}
    </>
  )
}

function CheckCard({ check }: { check: HealthCheckView }) {
  const state = stateOf(check.ok, check.severity)
  return (
    <Card data-testid={`health-check-${check.key}`} className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h2 className="min-w-0 text-base font-semibold text-ink [overflow-wrap:anywhere]">{check.title}</h2>
        <span data-testid="health-state">
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
        </span>
      </div>
      <p className="mt-1 text-sm text-ink [overflow-wrap:anywhere]" data-testid="health-message"><Prose text={check.message} /></p>
      {check.since && <p className="mt-0.5 text-xs text-ink-subtle">Since {fmtInstantIST(check.since)}</p>}
      <dl className="mt-3 space-y-2 text-sm">
        <div data-testid="health-why">
          <dt className="font-medium text-ink">Why it matters</dt>
          <dd className="text-ink-muted">{check.why}</dd>
        </div>
        {!check.ok && check.fix && (
          <div data-testid="health-fix">
            <dt className="font-medium text-ink">How to fix</dt>
            <dd className="text-ink-muted [overflow-wrap:anywhere]"><Prose text={check.fix} /></dd>
          </div>
        )}
      </dl>
      {check.history.length > 0 && (
        <details className="group mt-3 text-sm" open={!check.ok}>
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 font-medium text-ink max-sm:min-h-11 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden size={16} className="shrink-0 transition-transform group-open:rotate-90" />
            History ({check.history.length})
          </summary>
          <ol className="mt-1 space-y-2 border-l border-border pl-3">
            {check.history.map((h) => (
              <li key={h.from} data-testid="health-history-entry">
                <p className="text-ink">{historyLine(h)}</p>
                <p className="text-xs text-ink-muted [overflow-wrap:anywhere]">{h.message}</p>
                <a
                  href={activityAround(h.from)}
                  className="inline-flex min-h-8 items-center text-xs text-action underline underline-offset-2 max-sm:min-h-11"
                >
                  Activity around this change
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  )
}

export function InstanceHealth() {
  const health = useInstanceHealth(true)
  const data = health.data
  return (
    <div className="space-y-4" data-testid="instance-health">
      <div>
        <h1 className="text-lg font-semibold text-ink">{adminPageTitle('instance-health')}</h1>
        {data && (
          <p className="text-sm text-ink-muted" data-testid="instance-health-summary">
            {data.failing === 0 ? 'Every check passes.' : `${problemsLine(data.failing)}.`}
          </p>
        )}
      </div>
      {health.isPending && <Skeleton label="Checking instance health" className="w-full" />}
      {health.isError && !data && (
        <Notice tone="negative">
          <p>The checks could not be loaded.</p>
          <Button variant="secondary" className="mt-2" onClick={() => void health.refetch()}>Try again</Button>
        </Notice>
      )}
      {data && (
        <div className="space-y-3">
          {data.checks.map((c) => <CheckCard key={c.key} check={c} />)}
        </div>
      )}
    </div>
  )
}
