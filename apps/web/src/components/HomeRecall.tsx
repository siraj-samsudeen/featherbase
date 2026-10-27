import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { api, getSessionUser } from '../lib/api'
import { ago, displayEntry, recentActions, type RecentEntry } from '../lib/recents'
import { EntryLabel } from '../lib/row-titles'
import { buttonClasses, cardClasses } from './ui'

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

/** One routine's identity: its destinations, in any order. */
function signatureOf(targets: WorkspaceTarget[]): string {
  return targets.map((t) => t.key).sort().join('|')
}

export function ResumeStrip() {
  const router = useRouter()
  const user = getSessionUser()
  if (!user) return null
  const entries = recentActions(user.row_id, 40)
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
      <p className="mb-1.5 text-xs font-semibold text-ink-subtle">
        Continue where you left off
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => {
          // Rendered from the entry at display time: an old slug-labelled
          // page reads as its catalog title, a row as its title over its Table.
          const shown = displayEntry(t.entry)
          return (
            <button
              key={t.testid}
              type="button"
              onClick={t.open}
              data-testid={t.testid}
              className={cardClasses('p-3 text-left transition hover:border-action')}
            >
              <div className="text-xs font-semibold text-ink-subtle">
                {t.head}
              </div>
              <div className="mt-0.5 truncate text-sm font-medium text-ink" data-testid="resume-tile-title">
                <EntryLabel entry={t.entry} />
              </div>
              <div className="mt-0.5 truncate text-xs text-ink-muted" data-testid="resume-tile-sub">
                {shown.sub ? `${shown.sub} · ` : ''}
                {ago(t.entry.visits[t.entry.visits.length - 1] ?? 0)}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function RoutineCard() {
  const router = useRouter()
  const user = getSessionUser()
  const [workspace, setWorkspace] = useState<WorkspaceTarget[]>(() =>
    user ? loadWorkspace(user.row_id) : [],
  )
  const [dismissed, setDismissed] = useState(false)
  const suggestion = useQuery({
    queryKey: ['routine-suggestion'],
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: () => api.get<{ targets: WorkspaceTarget[] }>('/api/routine_suggestion'),
  })
  if (!user) return null

  // A pinned workspace replaces the suggestion until the user unpins it.
  if (workspace.length > 0)
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="workspace-chips">
        <span className="text-xs font-semibold text-ink-subtle">
          📌 My workspace
        </span>
        {workspace.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => router.history.push(t.path)}
            data-testid="workspace-chip"
            title={displayEntry(t).sub}
            className="max-w-72 truncate rounded-full bg-action-tint px-3 py-1 text-xs font-medium text-action hover:opacity-80"
          >
            <EntryLabel entry={t} />
            {displayEntry(t).sub ? <span className="ml-1 opacity-70">· {displayEntry(t).sub}</span> : null}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            // Unpinning also answers the offer for this same routine with
            // "Not now", so the card doesn't ask again straight away.
            try {
              localStorage.removeItem(WORKSPACE_KEY(user.row_id))
              localStorage.setItem(DISMISS_KEY(user.row_id), signatureOf(workspace))
            } catch {
              /* ignore */
            }
            setWorkspace([])
            setDismissed(true)
          }}
          data-testid="workspace-unpin"
          className={buttonClasses({ variant: 'quiet', className: 'text-xs' })}
        >
          Unpin
        </button>
      </div>
    )

  const targets = suggestion.data?.targets ?? []
  const signature = signatureOf(targets)
  let dismissedBefore = false
  try {
    dismissedBefore = localStorage.getItem(DISMISS_KEY(user.row_id)) === signature
  } catch {
    /* ignore */
  }
  if (targets.length < 2 || dismissed || dismissedBefore) return null

  return (
    <div
      className={cardClasses('border-l-2 border-l-action p-4')}
      data-testid="routine-card"
    >
      <p className="text-sm font-semibold text-ink">Looks like a routine</p>
      <p className="mt-0.5 text-sm text-ink-muted">
        You open these on most days:{' '}
        {targets.map((t, i) => (
          <span key={t.key} className="font-medium text-ink">
            {i > 0 ? ', ' : ''}
            <EntryLabel entry={t} />
            {displayEntry(t).sub ? ` (${displayEntry(t).sub})` : ''}
          </span>
        ))}
        . Pin them as your workspace?
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          className={buttonClasses({ variant: 'primary' })}
          data-testid="routine-pin"
          onClick={() => {
            try {
              localStorage.setItem(WORKSPACE_KEY(user.row_id), JSON.stringify(targets))
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
          className={buttonClasses()}
          data-testid="routine-dismiss"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY(user.row_id), signature)
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
