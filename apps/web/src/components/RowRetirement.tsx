import { useState } from 'react'
import { canRetire } from 'shared'
import { useQueryClient } from '@tanstack/react-query'
import { StatusPill, buttonClasses, cardClasses, fmtInstant, inputClasses, labelClasses } from '@featherbase/shop-floor'
import { ApiError, api } from '../lib/api'
import { PrincipalName } from '../lib/people'
import { RowTitle } from '../lib/row-titles'

// #859 (ADR 0019): retiring takes a row out of use without deleting it. The
// server owns every rule (the delete right to retire, the write right to
// reactivate, a reason required); these only ask and show.

type Row = Record<string, unknown>

/** Whether a Table's rows can be retired: the server's own rule. */
export const tableCanRetire = canRetire

const rowUrl = (table: string, name: string) =>
  `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`

/** What a retire or reactivate changes: the row, its list, its history, its advice. */
export async function refreshAfterRetirement(queryClient: ReturnType<typeof useQueryClient>, table: string, name: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['doc', table] }),
    queryClient.invalidateQueries({ queryKey: ['list', table] }),
    queryClient.invalidateQueries({ queryKey: ['activity', table, name] }),
    queryClient.invalidateQueries({ queryKey: ['row-capabilities'] }),
    // #959: the Recent chips over the list ask again whether it is retired.
    queryClient.invalidateQueries({ queryKey: ['recent-strip-rows', table] }),
  ])
}

export function RetiredBadge({ className }: { className?: string }) {
  // A border as well as the tint: on the form's own grey header the tint alone
  // all but vanished (verifier, #859).
  return <StatusPill tone="missing" className={`border border-ink-subtle ${className ?? ''}`}><span data-testid="retired-badge">Retired</span></StatusPill>
}

/** "Retired <when> by <who> — <why>", under a retired row's heading. */
export function RetiredNotice({ row }: { row: Row }) {
  if (row.retired_at == null) return null
  return (
    <p className="mb-3 text-sm text-ink-muted" data-testid="retired-notice">
      Retired {fmtInstant(String(row.retired_at))} by{' '}
      <span className="font-medium text-ink">{row.retired_by ? <PrincipalName id={String(row.retired_by)} /> : 'someone'}</span>
      {row.retired_reason ? <> — <span className="text-ink" data-testid="retired-reason">{String(row.retired_reason)}</span></> : null}
    </p>
  )
}

/** Asks for the reason, then retires the row. */
export function RetireDialog({ table, name, onClose, onSubmit }: { table: string; name: string; onClose: () => void; onSubmit?: () => void }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = reason.trim().length > 0 && !busy

  async function retire() {
    setBusy(true)
    setError(null)
    onSubmit?.()
    try {
      await api.post(`${rowUrl(table, name)}:retire`, { reason: reason.trim() })
      await refreshAfterRetirement(queryClient, table, name)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Retire failed')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40"
      onClick={() => !busy && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="retire-row-title"
        className={cardClasses('w-full max-w-md p-4')}
        data-testid="retire-row-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="retire-row-title" className="mb-2 text-base font-semibold text-ink">Retire {table}: <RowTitle table={table} rowId={name} />?</h2>
        <p className="mb-3 text-sm text-ink-muted">
          It stays, with its history, but lists and pickers stop offering it. You can reactivate it later.
        </p>
        <label htmlFor="retire-reason" className={labelClasses()}>Reason</label>
        <textarea
          id="retire-reason"
          autoFocus
          required
          maxLength={1000}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="retire-reason"
          className={inputClasses('mb-3 w-full')}
          placeholder="Why it is out of use"
        />
        {error && <p className="mb-3 text-sm text-negative" data-testid="retire-row-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={buttonClasses()} data-testid="retire-row-cancel">Cancel</button>
          <button
            onClick={retire}
            disabled={!ready}
            className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })}
            data-testid="retire-row-confirm"
          >
            {busy ? 'Retiring…' : 'Retire'}
          </button>
        </div>
      </div>
    </div>
  )
}

export async function reactivateRow(queryClient: ReturnType<typeof useQueryClient>, table: string, name: string) {
  await api.post(`${rowUrl(table, name)}:reactivate`, {})
  await refreshAfterRetirement(queryClient, table, name)
}
