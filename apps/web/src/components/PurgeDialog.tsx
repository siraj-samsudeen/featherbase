import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { canRetire } from 'shared'
import { Notice, buttonClasses, cardClasses, fmtCount, inputClasses, labelClasses } from '@featherbase/shop-floor'
import { ApiError, api } from '../lib/api'

// #859 (design decisions 9-14): a System Manager deletes rows permanently,
// with their history. The server works out what goes and what points at it;
// this shows that, asks how to treat the rows pointing at it, and asks for a
// reason and a typed confirmation. The server enforces every rule again.

interface PurgeRow { table: string; row_id: string; title: string; parent?: { table: string; row_id: string } }
interface PurgeGroup { table: string; column: string; lines: boolean; count: number; rows: PurgeRow[]; action: 'delete' | 'clear' | 'blocked'; why?: string }
interface PurgePlan {
  rows: PurgeRow[]
  groups: PurgeGroup[]
  blocked: boolean
  activity: { comments: number; versions: number; files: number; shares: number }
}

/** Whether a Table's rows may ever be deleted permanently (the server's purgeRefusal). */
export function tableCanPurge(meta: { name: string; kind: string; data_source?: string | null; system_written?: boolean; system?: boolean } | undefined): boolean {
  return Boolean(meta) && canRetire(meta) && !meta!.system
}

const CONFIRM_WORD = 'DELETE'
const SHOWN = 20

function RowLink({ row }: { row: PurgeRow }) {
  const target = row.parent ?? row
  return (
    <Link
      to="/featherbase/admin/table/$table/row/$name"
      params={{ table: target.table, name: target.row_id }}
      search={{ prefill: undefined }}
      className="text-action hover:underline"
      target="_blank"
    >
      {row.title}
    </Link>
  )
}

const plural = (n: number, one: string, many: string) => `${fmtCount(n)} ${n === 1 ? one : many}`

export function PurgeDialog({ table, ids, runId, onClose, onDone }: {
  table: string
  ids?: string[]
  runId?: string
  onClose: () => void
  onDone: (result: { deleted: number; cleared: number }) => void
}) {
  const queryClient = useQueryClient()
  const [links, setLinks] = useState<'cascade' | 'clear'>('cascade')
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = runId ? `run_id=${encodeURIComponent(runId)}` : `ids=${encodeURIComponent(JSON.stringify(ids ?? []))}`
  const plan = useQuery({
    queryKey: ['purge-preview', table, runId ?? ids, links],
    queryFn: () => api.get<PurgePlan>(`/api/table/${encodeURIComponent(table)}:purge_preview?${target}&links=${links}`),
    staleTime: 0,
  })
  const ready = Boolean(plan.data) && !plan.data!.blocked && plan.data!.rows.length > 0
    && reason.trim().length > 0 && typed.trim() === CONFIRM_WORD && !busy

  async function confirm() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{ deleted: number; cleared: number }>(`/api/table/${encodeURIComponent(table)}:purge`, {
        ...(runId ? { run_id: runId } : { ids }), links, reason: reason.trim(), confirm: true,
      })
      const touched = new Set([table, ...(plan.data?.rows ?? []).map((r) => r.table), ...(plan.data?.groups ?? []).map((g) => g.table)])
      await Promise.all([...touched].flatMap((t) => [
        queryClient.invalidateQueries({ queryKey: ['list', t] }),
        queryClient.invalidateQueries({ queryKey: ['doc', t] }),
      ]))
      onDone(result)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
      setBusy(false)
      void plan.refetch()
    }
  }

  const data = plan.data
  const asked = data ? data.rows.filter((r) => r.table === table) : []
  const removedWith = data ? data.rows.length - asked.length : 0
  const own = data?.activity
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40"
      onClick={() => !busy && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purge-title"
        className={cardClasses('max-h-[90vh] w-full max-w-xl overflow-y-auto p-4')}
        data-testid="purge-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="purge-title" className="mb-2 text-base font-semibold text-ink">Delete permanently</h2>
        {plan.isLoading && <p className="text-sm text-ink-muted">Working out what this removes…</p>}
        {plan.isError && (
          <p className="mb-3 text-sm text-negative" data-testid="purge-preview-error">
            {plan.error instanceof ApiError ? plan.error.message : 'Could not work out what this removes'}
          </p>
        )}
        {data && (
          <>
            <p className="mb-2 text-sm text-ink" data-testid="purge-summary">
              {plural(asked.length, `${table} row`, `${table} rows`)} will be deleted with everything recorded on {asked.length === 1 ? 'it' : 'them'}
              {own && (own.comments || own.versions || own.files || own.shares)
                ? `: ${[own.comments && plural(own.comments, 'comment', 'comments'), own.versions && plural(own.versions, 'history entry', 'history entries'), own.files && plural(own.files, 'attachment', 'attachments'), own.shares && plural(own.shares, 'share', 'shares')].filter(Boolean).join(', ')}`
                : ''}
              . This cannot be undone.
            </p>
            <ul className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-sm" data-testid="purge-rows">
              {asked.slice(0, SHOWN).map((r) => <li key={r.row_id}><RowLink row={r} /></li>)}
              {asked.length > SHOWN && <li className="text-ink-muted">and {fmtCount(asked.length - SHOWN)} more</li>}
            </ul>
            {data.groups.length > 0 && (
              <section className="mb-3" data-testid="purge-dependents">
                <h3 className="mb-1 text-sm font-semibold text-ink">Rows that point at {asked.length === 1 ? 'it' : 'them'}</h3>
                <fieldset className="mb-2 flex flex-wrap gap-4 text-sm" data-testid="purge-links">
                  <legend className="sr-only">What to do with them</legend>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="purge-links" checked={links === 'cascade'} onChange={() => setLinks('cascade')} data-testid="purge-links-cascade" />
                    Delete all of these too
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="purge-links" checked={links === 'clear'} onChange={() => setLinks('clear')} data-testid="purge-links-clear" />
                    Clear the link
                  </label>
                </fieldset>
                <ul className="space-y-2 text-sm">
                  {data.groups.map((g) => (
                    <li key={`${g.table}.${g.column}`} data-testid="purge-group" data-action={g.action}>
                      <div>
                        <span className="font-medium text-ink">{g.table}</span>{g.lines ? ' (lines)' : ''}: {fmtCount(g.count)}{' '}
                        <span className={g.action === 'blocked' ? 'text-negative' : 'text-ink-muted'} data-testid="purge-group-action">
                          {g.action === 'delete' ? '— will be deleted' : g.action === 'clear' ? `— ${g.column} will be cleared` : `— cannot be deleted or unlinked here: ${g.why}`}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3">
                        {g.rows.map((r) => <RowLink key={`${r.table}/${r.row_id}`} row={r} />)}
                        {g.count > g.rows.length && <span className="text-ink-muted">and {fmtCount(g.count - g.rows.length)} more</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                {removedWith > 0 && <p className="mt-1 text-xs text-ink-muted">{plural(removedWith, 'row', 'rows')} in all go with {asked.length === 1 ? 'it' : 'them'}.</p>}
              </section>
            )}
            {data.blocked && (
              <Notice tone="caution" className="mb-3">
                <span data-testid="purge-blocked">Some rows that point at {asked.length === 1 ? 'this' : 'these'} can be neither deleted nor unlinked here. Change them first, then try again.</span>
              </Notice>
            )}
            <label htmlFor="purge-reason" className={labelClasses()}>Reason</label>
            <textarea
              id="purge-reason"
              required
              rows={2}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inputClasses('mb-2 w-full')}
              placeholder="Why these rows are being deleted"
              data-testid="purge-reason"
            />
            <label htmlFor="purge-confirm" className={labelClasses()}>Type {CONFIRM_WORD} to confirm</label>
            <input
              id="purge-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className={inputClasses('mb-3 w-full')}
              data-testid="purge-confirm-word"
            />
          </>
        )}
        {error && <p className="mb-3 text-sm text-negative" data-testid="purge-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={buttonClasses()} data-testid="purge-cancel">Cancel</button>
          <button
            onClick={confirm}
            disabled={!ready}
            className={buttonClasses({ className: 'border-negative text-negative hover:bg-negative-tint disabled:opacity-40' })}
            data-testid="purge-confirm"
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}
