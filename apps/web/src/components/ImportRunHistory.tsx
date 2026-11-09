import { useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { PurgeDialog, tableCanPurge } from './PurgeDialog'
import { useIsSystemManager } from '../lib/session'
import { useMeta } from '../lib/meta'
import { buttonClasses, cardClasses } from '@featherbase/shop-floor'
import { fmtCount } from '@featherbase/shop-floor'

// Spec 0005 (RVT-J1): revert the run just imported. Rehearse first — a dry
// run's counts before anything commits — then the real revert; rows edited
// after the import come back skipped and NAMED, and reverting those too is
// only ever a second, explicitly chosen act over the named list (RVT-R5).
const SKIP_WORDS: Record<string, string> = {
  'edited-after': 'edited after this import',
  'row-deleted': 'deleted since',
  'already-gone': 'already removed',
  unchanged: 'no changes to undo',
  'no-version-trail': 'no change history',
}

interface RevertReport {
  restored: number
  deleted: number
  skipped: { row_id: string; reason: string }[]
  failed: { row_id: string; message: string }[]
}

export function RevertControl({ i, table, runId }: { i: number | string; table: string; runId: string }) {
  const [preview, setPreview] = useState<RevertReport | null>(null)
  const [outcome, setOutcome] = useState<RevertReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(body: Record<string, unknown>): Promise<RevertReport | null> {
    setBusy(true)
    setError(null)
    try {
      return await api.post<RevertReport>(`/api/table/${encodeURIComponent(table)}:import-revert`, {
        run_id: runId,
        ...body,
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Revert failed')
      return null
    } finally {
      setBusy(false)
    }
  }

  const skips = (r: RevertReport) =>
    r.skipped.map((s) => `${s.row_id} (${SKIP_WORDS[s.reason] ?? s.reason})`).join(', ')

  if (outcome) {
    const editedAfter = outcome.skipped.filter((s) => s.reason === 'edited-after')
    return (
      <div className="mt-1 text-sm" data-testid={`iw-revert-result-${i}`}>
        <span className={outcome.failed.length ? 'text-negative' : 'text-positive'}>
          Reverted: {outcome.restored} restored, {outcome.deleted} deleted
          {outcome.skipped.length > 0 && `; skipped ${skips(outcome)}`}
          {outcome.failed.length > 0 &&
            `; failed ${outcome.failed.map((f) => `${f.row_id}: ${f.message}`).join('; ')}`}
        </span>
        {editedAfter.length > 0 && (
          <button
            className={buttonClasses({ className: 'ml-2 py-0.5 text-xs' })}
            data-testid={`iw-revert-override-${i}`}
            disabled={busy}
            onClick={async () => {
              const r = await call({ override: editedAfter.map((s) => s.row_id) })
              if (r) setOutcome(r)
            }}
          >
            Revert these {editedAfter.length} anyway
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mt-1 text-sm" data-testid={`iw-revert-${i}`}>
      {preview === null ? (
        <button
          className={buttonClasses({ className: 'py-0.5 text-xs' })}
          data-testid={`iw-revert-open-${i}`}
          disabled={busy}
          onClick={async () => {
            const r = await call({ dry_run: true })
            if (r) setPreview(r)
          }}
        >
          Revert this run…
        </button>
      ) : (
        <span data-testid={`iw-revert-preview-${i}`}>
          Will restore {preview.restored} updated rows and delete {preview.deleted} added rows
          {preview.skipped.length > 0 && `; skipping ${skips(preview)}`}.{' '}
          <button
            className={buttonClasses({ variant: 'primary', className: 'ml-1 py-0.5 text-xs' })}
            data-testid={`iw-revert-confirm-${i}`}
            disabled={busy || (preview.restored === 0 && preview.deleted === 0)}
            onClick={async () => {
              const r = await call({})
              if (r) {
                setOutcome(r)
                setPreview(null)
              }
            }}
          >
            Revert
          </button>{' '}
          <button
            className={buttonClasses({ className: 'ml-1 py-0.5 text-xs' })}
            onClick={() => setPreview(null)}
            disabled={busy}
          >
            Cancel
          </button>
        </span>
      )}
      {error && <span className="ml-2 text-negative">{error}</span>}
    </div>
  )
}

// RVT-J1.1's second entry point: the history strip. A wizard opened from a
// Table's list (the ?table= preselect) shows that Table's recent runs, each
// with its revert control — the way back to a run after the wizard's
// auto-navigation has moved on. Reads the Import Log the way the R5
// suggestion does: no grant (or a mid-upgrade database) → no strip, silently.
interface RunEntry {
  run_id: string
  file_name: string | null
  inserted: number
  updated: number
  failed: number
  reverted_at: string | null
}

export function RunHistory({ table }: { table: string }) {
  // #859: a System Manager may delete the rows a run added, permanently.
  const isSystemManager = useIsSystemManager()
  const meta = useMeta(table)
  const canPurge = isSystemManager && tableCanPurge(meta.data)
  const [purgeRun, setPurgeRun] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const runs = useQuery({
    queryKey: ['iw-run-history', table],
    staleTime: 10_000,
    retry: false,
    queryFn: async (): Promise<RunEntry[]> => {
      const logs = await api.get<{
        data: {
          run_id: string | null
          file_name: string | null
          inserted: unknown
          updated: unknown
          failed: unknown
          reverted_at: string | null
        }[]
      }>(
        `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
          '["run_id","file_name","inserted","updated","failed","reverted_at","created_at"]',
        )}&filters=${encodeURIComponent(
          JSON.stringify([['ref_table', '=', table]]),
        )}&order_by=${encodeURIComponent('created_at desc')}&limit_page_length=40`,
      )
      const byRun = new Map<string, RunEntry>()
      for (const l of logs.data) {
        if (!l.run_id) continue // pre-run_id logs are not revertable
        const r = byRun.get(l.run_id) ?? {
          run_id: l.run_id,
          file_name: l.file_name,
          inserted: 0,
          updated: 0,
          failed: 0,
          reverted_at: null,
        }
        r.inserted += Number(l.inserted ?? 0)
        r.updated += Number(l.updated ?? 0)
        r.failed += Number(l.failed ?? 0)
        r.reverted_at = r.reverted_at ?? l.reverted_at
        byRun.set(l.run_id, r)
      }
      return [...byRun.values()].slice(0, 5)
    },
  })
  // Whether a run's added rows are still there, from the server, so a reload
  // tells the same story.
  const remaining = useQueries({
    queries: (runs.data ?? []).map((r) => ({
      queryKey: ['iw-run-remaining', table, r.run_id],
      enabled: canPurge && r.inserted > 0,
      queryFn: () => api.get<{ remaining: number }>(`/api/table/${encodeURIComponent(table)}:purge_run_remaining?run_id=${encodeURIComponent(r.run_id)}`),
    })),
  })
  if (!runs.data?.length) return null
  const gone = (r: RunEntry, idx: number) => canPurge && r.inserted > 0 && remaining[idx]?.data?.remaining === 0
  return (
    <div className={cardClasses('mt-4 p-3')} data-testid="iw-run-history">
      {purgeRun && (
        <PurgeDialog
          table={table}
          runId={purgeRun}
          onClose={() => setPurgeRun(null)}
          onDone={() => {
            setPurgeRun(null)
            void runs.refetch()
            void queryClient.invalidateQueries({ queryKey: ['iw-run-remaining', table] })
          }}
        />
      )}
      <div className="mb-1 text-xs font-medium text-ink-muted">Recent imports into {table}</div>
      {runs.data.map((r, idx) => (
        <div
          key={r.run_id}
          className="flex flex-wrap items-center gap-2 text-sm"
          data-testid={`iw-run-${idx}`}
        >
          <span>
            {r.file_name ?? 'API import'} — {fmtCount(r.updated)} processed matches · {fmtCount(r.inserted)} added · {fmtCount(r.failed)}{' '}
            failed
          </span>
          {gone(r, idx) && (
            <span className="text-xs text-ink-subtle" data-testid={`iw-run-purged-${idx}`}>its added rows are gone</span>
          )}
          {gone(r, idx) && r.updated === 0 ? null : r.reverted_at ? (
            <span className="text-xs text-ink-subtle">reverted</span>
          ) : (
            <RevertControl i={`h${idx}`} table={table} runId={r.run_id} />
          )}
          {canPurge && r.inserted > 0 && !r.reverted_at && remaining[idx]?.data?.remaining ? (
            <button
              className={buttonClasses({ className: 'border-negative text-negative hover:bg-negative-tint' })}
              onClick={() => setPurgeRun(r.run_id)}
              data-testid={`iw-run-purge-${idx}`}
            >
              Delete its rows permanently
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
