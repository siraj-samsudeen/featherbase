// #1418 (Option A, picked by Siraj 28-Nov-2026): above a read-only copy's
// list, what it holds and the two ways to load it. A load runs only when
// someone asks: "Check for a new run" loads only when the warehouse names a
// new run, "Load now" whatever the run is. The load runs in the background,
// so the bar asks again until it ends, then the list follows.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Notice, RecordLink, cardClasses, fmtCount, tagClasses } from '@featherbase/shop-floor'
import { ApiError, api } from '../lib/api'
import { formatValue, useSettings } from '../lib/settings'

interface LoadState {
  app_title: string
  source: string
  can_open_source: boolean
  run: Record<string, unknown> | null
  loaded_at: string | null
  rows: number | null
  failed: { at: string; reason: string } | null
  pending: 'queued' | 'running' | null
}

/** How often the bar asks while a load runs. */
const WHILE_LOADING_MS = 2000

export function ReadOnlyCopyBar({ table }: { table: string }) {
  const queryClient = useQueryClient()
  const settings = useSettings()
  const [asked, setAsked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = useQuery({
    queryKey: ['copy-load-state', table],
    // Null for anyone who may not load the copy: no bar, and no failing request.
    queryFn: () => api.get<LoadState | null>(`/api/table/${encodeURIComponent(table)}:copy_load_state`),
    retry: false,
    refetchInterval: (query) => (query.state.data?.pending ? WHILE_LOADING_MS : false),
  })
  const s = state.data
  const ended = asked && s != null && !s.pending
  // A load this bar started has ended: the list shows the run it left.
  useEffect(() => {
    if (!ended) return
    setAsked(false)
    void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'copy-load-state' })
  }, [ended, queryClient])
  if (!s) return null

  async function load(force: boolean) {
    setError(null)
    try {
      await api.post('/api/copy_load', { table, force })
      // Waiting until the next answer says otherwise, so the bar never takes
      // the state from before the press for a load that already ended.
      queryClient.setQueryData<LoadState | null>(['copy-load-state', table], (old) => old && { ...old, pending: old.pending ?? 'queued' })
      setAsked(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The load could not be started')
    }
  }

  const run = s.run ? Object.values(s.run).map(String).join(' · ') : null
  const when = (at: string) => formatValue('Datetime', at, settings)
  return (
    <div className="mb-4 space-y-2" data-testid="read-only-copy-bar">
      <div className={cardClasses('flex flex-wrap items-center justify-between gap-3 px-4 py-3')}>
        <p className="text-sm text-ink-muted">
          <span className={tagClasses('mr-2')}>Read-only copy</span>
          Loaded by <span className="font-semibold text-ink">{s.app_title}</span> from{' '}
          <RecordLink table="Data Source" rowId={s.source} name={s.source} canOpen={s.can_open_source} />
          {s.loaded_at
            ? <>{run && <> · run <span className="font-mono">{run}</span></>} · {fmtCount(s.rows)} rows · loaded {when(s.loaded_at)}</>
            : <> · not loaded yet</>}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={Boolean(s.pending)} onClick={() => load(false)} data-testid="copy-check">Check for a new run</Button>
          <Button variant="secondary" disabled={Boolean(s.pending)} onClick={() => load(true)} data-testid="copy-load-now">Load now</Button>
        </div>
      </div>
      {s.pending && <Notice tone="info">A load is running. The list shows the run above until it finishes.</Notice>}
      {!s.pending && s.failed && <Notice tone="negative">The last load ({when(s.failed.at)}) was refused: {s.failed.reason.replace(/\.$/, '')}.</Notice>}
      {error && <Notice tone="negative">{error}</Notice>}
    </div>
  )
}
