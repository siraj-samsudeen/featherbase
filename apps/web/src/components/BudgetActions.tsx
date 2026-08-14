import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { ApiError, api } from '../lib/api'

// Spec 0007 M2 (BUD-R2 in the browser): the Budget Book lifecycle actions.
// Server enforces every transition; these buttons are a convenience over
// the :baseline / :close / :snapshot row actions. Confirmation is inline
// (the FormView rename idiom), never a native dialog.
export function BudgetActions({ name, lifecycle }: { name: string; lifecycle: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<null | 'baseline' | 'close' | 'snapshot'>(null)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'reforecast' | 'adhoc'>('reforecast')

  async function run(action: string, args: Record<string, unknown> = {}) {
    setBusy(true)
    setError(null)
    try {
      await api.post(
        `/api/table/${encodeURIComponent('Budget Book')}/${encodeURIComponent(name)}:${action}`,
        args,
      )
      setConfirming(null)
      setLabel('')
      await queryClient.invalidateQueries({ queryKey: ['doc', 'Budget Book', name] })
      await queryClient.invalidateQueries({ queryKey: ['list', 'Budget Book'] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${action} failed`)
    } finally {
      setBusy(false)
    }
  }

  const pill =
    lifecycle === 'active'
      ? 'bg-[var(--color-good-tint)] text-[var(--color-good)]'
      : lifecycle === 'closed'
        ? 'bg-[var(--color-subtle)] text-[var(--color-ink-muted)]'
        : 'bg-[var(--color-brand-tint)] text-[var(--color-brand)]'

  return (
    <span className="flex items-center gap-2" data-testid="budget-actions">
      <span className={`fc-pill ${pill}`} data-testid="budget-lifecycle">
        {lifecycle || 'working'}
      </span>
      {confirming === null && lifecycle === 'working' && (
        <button
          onClick={() => setConfirming('baseline')}
          disabled={busy}
          data-testid="budget-baseline"
          className="fc-btn-primary disabled:opacity-40"
        >
          Baseline…
        </button>
      )}
      {confirming === null && lifecycle === 'active' && (
        <>
          <button
            onClick={() => setConfirming('snapshot')}
            disabled={busy}
            data-testid="budget-snapshot"
            className="fc-btn"
          >
            Snapshot…
          </button>
          <RouterLink
            to="/admin/budget-compare"
            search={{ book: name, from: undefined, to: undefined }}
            data-testid="budget-compare-link"
            className="fc-btn"
          >
            Compare
          </RouterLink>
          <button
            onClick={() => setConfirming('close')}
            disabled={busy}
            data-testid="budget-close"
            className="fc-btn border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)]"
          >
            Close…
          </button>
        </>
      )}
      {confirming === null && lifecycle === 'closed' && (
        <RouterLink
          to="/admin/budget-compare"
          search={{ book: name, from: undefined, to: undefined }}
          data-testid="budget-compare-link"
          className="fc-btn"
        >
          Compare
        </RouterLink>
      )}
      {confirming === 'baseline' && (
        <span className="flex items-center gap-1 text-xs" data-testid="budget-baseline-confirm">
          <span className="text-[var(--color-ink-muted)]">
            Freeze this book? v0 is written; all further changes ride Budget Changes.
          </span>
          <button onClick={() => run('baseline')} disabled={busy} data-testid="budget-baseline-go" className="fc-btn-primary">
            Baseline
          </button>
          <button onClick={() => setConfirming(null)} className="fc-btn">
            Cancel
          </button>
        </span>
      )}
      {confirming === 'close' && (
        <span className="flex items-center gap-1 text-xs" data-testid="budget-close-confirm">
          <span className="text-[var(--color-ink-muted)]">
            Close this book? Governance ends; snapshots and history remain.
          </span>
          <button onClick={() => run('close')} disabled={busy} data-testid="budget-close-go" className="fc-btn-primary">
            Close book
          </button>
          <button onClick={() => setConfirming(null)} className="fc-btn">
            Cancel
          </button>
        </span>
      )}
      {confirming === 'snapshot' && (
        <span className="flex items-center gap-1" data-testid="budget-snapshot-confirm">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label, e.g. LE-June"
            data-testid="budget-snapshot-label"
            className="fc-input w-36"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'reforecast' | 'adhoc')}
            data-testid="budget-snapshot-kind"
            className="fc-input w-28"
          >
            <option value="reforecast">reforecast</option>
            <option value="adhoc">adhoc</option>
          </select>
          <button
            onClick={() => run('snapshot', { label, kind })}
            disabled={busy || !label.trim()}
            data-testid="budget-snapshot-go"
            className="fc-btn-primary disabled:opacity-40"
          >
            Snapshot
          </button>
          <button onClick={() => setConfirming(null)} className="fc-btn">
            Cancel
          </button>
        </span>
      )}
      {error && (
        <span className="text-xs text-[var(--color-danger)]" data-testid="budget-action-error">
          {error}
        </span>
      )}
    </span>
  )
}

interface LineGovernance {
  book: {
    name: string
    lifecycle: string
    measure_columns: string[]
  } | null
  pending: { name: string; change_type: string; reason: string; created_by: string }[]
}

// Spec 0007 M2 (BUD-J2's front door): on a row of a governed table, show
// which book governs it, how many draft changes already touch it, and the
// one-click path to proposing a change with this line pre-loaded.
export function BudgetGovernance({ doctype, name }: { doctype: string; name: string }) {
  const query = useQuery({
    queryKey: ['budget-line', doctype, name],
    queryFn: () =>
      api.get<LineGovernance>(
        `/api/budget/line/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
      ),
  })
  const status = query.data
  if (!status?.book || status.book.lifecycle !== 'active') return null
  const prefill = JSON.stringify({
    book: status.book.name,
    change_type: 'revise',
    lines: [{ line_ref: name }],
  })
  return (
    <span className="flex items-center gap-2" data-testid="budget-governance">
      <span
        className="fc-pill bg-[var(--color-brand-tint)] text-[var(--color-brand)]"
        title={`Rows of this table change through Budget Changes on ${status.book.name}`}
        data-testid="budget-governed-pill"
      >
        Governed · {status.book.name}
      </span>
      {status.pending.length > 0 && (
        <span
          className="fc-pill bg-[var(--color-subtle)] text-[var(--color-ink-muted)]"
          title={status.pending
            .map((p) => `${p.name} (${p.change_type}, ${p.created_by}): ${p.reason}`)
            .join('\n')}
          data-testid="budget-pending-badge"
        >
          {status.pending.length} pending
        </span>
      )}
      <RouterLink
        to="/admin/$doctype/$name"
        params={{ doctype: 'Budget Change', name: 'new' }}
        search={{ prefill }}
        data-testid="budget-propose"
        className="fc-btn"
      >
        Propose change
      </RouterLink>
    </span>
  )
}
