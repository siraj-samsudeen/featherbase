import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { api, getSessionUser } from '../lib/api'
import { ago, recentActions, type RecentEntry } from '../lib/recents'

// #101 Phase 5: the Home Page's first job becomes resuming. ResumeStrip
// offers the last row / list / search as one-click tiles (instant, straight
// from the localStorage buffer). RoutineCard asks the server whether a
// routine holds — destinations opened on many distinct days — and offers to
// pin it; the pin is stored per user and rendered as a chip row from then on.

const WORKSPACE_KEY = (user: string) => `fc-workspace:${user}`
const DISMISS_KEY = (user: string) => `fc-routine-dismissed:${user}`

interface WorkspaceTarget {
  key: string
  label: string
  sub?: string
  path: string
}

function loadWorkspace(user: string): WorkspaceTarget[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(WORKSPACE_KEY(user)) ?? '[]')
    return Array.isArray(parsed) ? (parsed as WorkspaceTarget[]) : []
  } catch {
    return []
  }
}

export function ResumeStrip() {
  const router = useRouter()
  const user = getSessionUser()
  if (!user) return null
  const entries = recentActions(user.name, 40)
  const lastRow = entries.find((e) => e.kind === 'row')
  const lastView = entries.find((e) => e.kind === 'list' || e.kind === 'page')
  const lastSearch = entries.find((e) => e.kind === 'search')
  const tiles: Array<{ head: string; entry: RecentEntry; testid: string; open: () => void }> = []
  if (lastRow)
    tiles.push({
      head: 'Last row',
      entry: lastRow,
      testid: 'resume-tile-row',
      open: () => router.history.push(lastRow.path),
    })
  if (lastView)
    tiles.push({
      head: 'Last view',
      entry: lastView,
      testid: 'resume-tile-view',
      open: () => router.history.push(lastView.path),
    })
  if (lastSearch)
    tiles.push({
      head: 'Last search',
      entry: lastSearch,
      testid: 'resume-tile-search',
      // The command bar owns search — hand it the query, prefilled + focused.
      open: () =>
        window.dispatchEvent(new CustomEvent('fc:prefill-search', { detail: lastSearch.label })),
    })
  if (tiles.length === 0) return null
  return (
    <div data-testid="resume-strip">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
        Continue where you left off
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <button
            key={t.testid}
            type="button"
            onClick={t.open}
            data-testid={t.testid}
            className="fc-card p-3 text-left transition hover:border-[var(--color-brand)]"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t.head}
            </div>
            <div className="mt-0.5 truncate text-sm font-medium text-[var(--color-ink)]">
              {t.entry.label}
            </div>
            <div className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">
              {t.entry.sub ? `${t.entry.sub} · ` : ''}
              {ago(t.entry.visits[t.entry.visits.length - 1] ?? 0)}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function RoutineCard() {
  const router = useRouter()
  const user = getSessionUser()
  const [workspace, setWorkspace] = useState<WorkspaceTarget[]>(() =>
    user ? loadWorkspace(user.name) : [],
  )
  const [dismissed, setDismissed] = useState(false)
  const suggestion = useQuery({
    queryKey: ['routine-suggestion'],
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: () => api.get<{ targets: WorkspaceTarget[] }>('/api/routine_suggestion'),
  })
  if (!user) return null

  // A pinned workspace replaces the suggestion permanently.
  if (workspace.length > 0)
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="workspace-chips">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
          📌 My workspace
        </span>
        {workspace.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => router.history.push(t.path)}
            data-testid="workspace-chip"
            title={t.sub}
            className="max-w-72 truncate rounded-full bg-[var(--color-brand-tint)] px-3 py-1 text-xs font-medium text-[var(--color-brand)] hover:opacity-80"
          >
            {t.label}
            {t.sub ? <span className="ml-1 opacity-70">· {t.sub}</span> : null}
          </button>
        ))}
      </div>
    )

  const targets = suggestion.data?.targets ?? []
  const signature = targets.map((t) => t.key).sort().join('|')
  let dismissedBefore = false
  try {
    dismissedBefore = localStorage.getItem(DISMISS_KEY(user.name)) === signature
  } catch {
    /* ignore */
  }
  if (targets.length < 2 || dismissed || dismissedBefore) return null

  return (
    <div
      className="fc-card border-l-2 border-l-[var(--color-brand)] p-4"
      data-testid="routine-card"
    >
      <p className="text-sm font-semibold text-[var(--color-ink)]">Looks like a routine</p>
      <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
        You open these on most days:{' '}
        {targets.map((t, i) => (
          <span key={t.key} className="font-medium text-[var(--color-ink)]">
            {i > 0 ? ', ' : ''}
            {t.label}
            {t.sub ? ` (${t.sub})` : ''}
          </span>
        ))}
        . Pin them as your workspace?
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          className="fc-btn-primary"
          data-testid="routine-pin"
          onClick={() => {
            try {
              localStorage.setItem(WORKSPACE_KEY(user.name), JSON.stringify(targets))
            } catch {
              /* ignore */
            }
            setWorkspace(targets)
          }}
        >
          Pin workspace
        </button>
        <button
          type="button"
          className="fc-btn"
          data-testid="routine-dismiss"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY(user.name), signature)
            } catch {
              /* ignore */
            }
            setDismissed(true)
          }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}
