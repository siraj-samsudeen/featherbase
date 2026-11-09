import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getSessionUser } from '../lib/api'
import { buttonClasses, inputClasses } from '@featherbase/shop-floor'
import type { Filter } from './ListFilters'

// #101 Phase 6: saved views + the proactive nudge. A saved view is a named,
// shareable filter set (server-owned rows); the nudge notices the same
// filter set applied 3+ times inside a week and offers to name it — the
// habit becomes an artifact instead of a memory.
const NUDGE_THRESHOLD = 3
const NUDGE_WINDOW_MS = 7 * 86_400_000

interface SavedViewRow {
  row_id: string
  label: string
  filters: Filter[]
  shared: boolean
  mine: boolean
}

export function SavedViewsBar({
  table,
  filters,
  onApply,
}: {
  table: string
  filters: Filter[]
  onApply: (filters: Filter[]) => void
}) {
  const user = getSessionUser()
  const queryClient = useQueryClient()
  const [nudgeGone, setNudgeGone] = useState(false)
  const [applyCount, setApplyCount] = useState(0)
  const [nudgeName, setNudgeName] = useState('')
  const [naming, setNaming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const views = useQuery({
    queryKey: ['saved-views', table],
    enabled: Boolean(user),
    queryFn: () => api.get<{ views: SavedViewRow[] }>(`/api/saved_views?table=${encodeURIComponent(table)}`),
  })

  const sig = filters.length > 0 ? JSON.stringify(filters) : ''
  const countKey = user ? `fc-filter-count:${user.row_id}` : ''
  const dismissKey = user ? `fc-nudge-dismissed:${user.row_id}` : ''

  // Every arrival at a non-empty filter state counts as one application.
  useEffect(() => {
    setNudgeGone(false)
    setNaming(false)
    setNudgeName('')
    setSaveError('')
    if (!user || !sig) {
      setApplyCount(0)
      return
    }
    try {
      const store = JSON.parse(localStorage.getItem(countKey) ?? '{}') as Record<
        string,
        { n: number; t: number }
      >
      const k = `${table}|${sig}`
      const rec = store[k] ?? { n: 0, t: 0 }
      const now = Date.now()
      if (now - rec.t > NUDGE_WINDOW_MS) rec.n = 0
      // A re-mount within half a second is the same arrival (StrictMode
      // double-invokes effects in dev), not a second application.
      if (now - rec.t > 500) rec.n += 1
      rec.t = now
      store[k] = rec
      const keys = Object.keys(store)
      if (keys.length > 50) {
        keys.sort((a, b) => store[a].t - store[b].t)
        for (const stale of keys.slice(0, keys.length - 50)) delete store[stale]
      }
      localStorage.setItem(countKey, JSON.stringify(store))
      setApplyCount(rec.n)
    } catch {
      setApplyCount(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, sig, user?.row_id])

  if (!user) return null
  const list = views.data?.views ?? []

  const matching = list.find((v) => JSON.stringify(v.filters) === sig)
  let dismissed = false
  try {
    dismissed = Boolean(
      (JSON.parse(localStorage.getItem(dismissKey) ?? '{}') as Record<string, boolean>)[
        `${table}|${sig}`
      ],
    )
  } catch {
    /* ignore */
  }
  const showNudge = Boolean(sig && applyCount >= NUDGE_THRESHOLD && !matching && !dismissed && !nudgeGone)
  const showForm = Boolean(sig && (naming || showNudge))

  async function saveView() {
    const label = nudgeName.trim() || `${table} view`
    setSaving(true)
    setSaveError('')
    try {
      await api.post('/api/saved_views', { table, label, filters })
      try {
        const store = JSON.parse(localStorage.getItem(countKey) ?? '{}') as Record<string, unknown>
        delete store[`${table}|${sig}`]
        localStorage.setItem(countKey, JSON.stringify(store))
      } catch {
        /* ignore */
      }
      setNudgeGone(true)
      setNaming(false)
      setNudgeName('')
      // Invalidation reuses a pending initial read with no cached data. Cancel
      // it first so its pre-save result cannot hide the newly saved view.
      await queryClient.cancelQueries({ queryKey: ['saved-views', table] })
      void queryClient.invalidateQueries({ queryKey: ['saved-views', table] })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Couldn't save this view. Try again.")
    } finally {
      setSaving(false)
    }
  }

  function dismissNudge() {
    try {
      const store = JSON.parse(localStorage.getItem(dismissKey) ?? '{}') as Record<string, boolean>
      store[`${table}|${sig}`] = true
      localStorage.setItem(dismissKey, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    setNudgeGone(true)
  }

  if (list.length === 0 && !sig) return null

  return (
    <div className="mb-3" data-testid="saved-views-bar">
      {list.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-subtle">
            Views
          </span>
          {list.map((v) => {
            const active = JSON.stringify(v.filters) === sig
            return (
              <span
                key={v.row_id}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  active
                    ? 'bg-action text-action-ink'
                    : 'bg-action-tint text-action'
                }`}
              >
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onApply(v.filters)}
                  data-testid="saved-view-chip"
                  title={v.mine ? undefined : `shared by its owner`}
                >
                  ★ {v.label}
                  {v.shared && <span className="ml-1 opacity-70">{v.mine ? '· shared' : '· 👥'}</span>}
                </button>
                {v.mine && active && (
                  <button
                    type="button"
                    data-testid="saved-view-share"
                    title={v.shared ? 'Make private' : 'Share with everyone'}
                    onClick={async () => {
                      await api.post(`/api/saved_views/${encodeURIComponent(v.row_id)}/share`, {
                        shared: !v.shared,
                      })
                      void queryClient.invalidateQueries({ queryKey: ['saved-views', table] })
                    }}
                    className="rounded-full px-1 hover:bg-surface/20"
                  >
                    {v.shared ? '🔒' : '👥'}
                  </button>
                )}
                {v.mine && (
                  <button
                    type="button"
                    aria-label={`Delete view ${v.label}`}
                    data-testid="saved-view-delete"
                    onClick={async () => {
                      await api.delete(`/api/saved_views/${encodeURIComponent(v.row_id)}`)
                      void queryClient.invalidateQueries({ queryKey: ['saved-views', table] })
                    }}
                    className="rounded-full px-1 hover:bg-surface/20"
                  >
                    ✕
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}
      {sig && !showForm && (
        <button type="button" onClick={() => setNaming(true)} data-testid="save-view-open" className={buttonClasses({ className: 'mt-2' })}>
          Save view
        </button>
      )}
      {showForm && (
        <form
          onSubmit={(event) => { event.preventDefault(); void saveView() }}
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-action/40 bg-action-tint px-3 py-2 text-sm"
          data-testid="saved-view-form"
        >
          {showNudge && (
            <span className="text-ink" data-testid="filter-nudge">
              That's <b>{applyCount}×</b> for this filter in a week — save it as a view?
            </span>
          )}
          <label className="flex min-w-0 flex-wrap items-center gap-2 text-ink">
            View name
            <input
              value={nudgeName}
              onChange={(e) => setNudgeName(e.target.value)}
              placeholder={`${table} view`}
              data-testid="nudge-name"
              disabled={saving}
              className={inputClasses('w-44 max-w-full')}
            />
          </label>
          <button type="submit" disabled={saving} data-testid="nudge-save" className={buttonClasses({ variant: 'primary' })}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" disabled={saving} onClick={() => {
            setNaming(false)
            setNudgeName('')
            setSaveError('')
            setNudgeGone(true)
          }} className={buttonClasses()}>
            Cancel
          </button>
          {showNudge && (
            <button type="button" disabled={saving} onClick={dismissNudge} data-testid="nudge-dismiss" className={buttonClasses()}>
              Not now
            </button>
          )}
          {saveError && <p role="alert" data-testid="saved-view-error" className="w-full break-words text-sm text-negative">{saveError}</p>}
        </form>
      )}
    </div>
  )
}
