import { useState } from 'react'
import { ApiError, api, listResource } from '../lib/api'

// Spec 0007, BUD-J4 in the wizard (M3 UI): when an import's target table is
// governed by an ACTIVE Budget Book, the sheet's import flow becomes the
// proposal flow — the file is never written to the table; it diffs into
// draft Budget Changes via :import_proposal, previewed first, approved later
// through the ordinary lanes.

export interface GoverningBook {
  name: string
  measures: string[]
}

// The active book governing a table, if any — with its measure columns (the
// effective_from choices for discontinue-missing). A reader without a grant
// on Budget Book simply gets null and the wizard falls back to plain import,
// whose per-row refusals name this road.
export async function governingBookFor(table: string): Promise<GoverningBook | null> {
  try {
    const hit = await listResource<{ row_id: string }>('Budget Book', {
      filters: [
        ['ref_table', '=', table],
        ['lifecycle', '=', 'active'],
      ],
      fields: ['row_id'],
      limit_page_length: 1,
    })
    const name = hit.data[0]?.row_id
    if (!name) return null
    const doc = await api.get<{ measure_columns?: { column_name: string }[] }>(
      `/api/table/${encodeURIComponent('Budget Book')}/${encodeURIComponent(name)}`,
    )
    return { name, measures: (doc.measure_columns ?? []).map((m) => m.column_name) }
  } catch {
    return null
  }
}

interface ProposalReport {
  dry_run?: boolean
  matched_rows: number
  changed_cells: number
  new_rows: number
  unchanged_rows: number
  discontinued_rows: number
  ignored_columns: string[]
  changes: { row_id?: string; change_type: string; lines: number | unknown[] }[]
}

const TYPE_WORDS: Record<string, string> = {
  revise: 'revised cells',
  new_line: 'new rows',
  discontinue: 'discontinued rows',
}

function DiffSummary({ i, r }: { i: number; r: ProposalReport }) {
  return (
    <span data-testid={`iw-gov-diff-${i}`}>
      <strong>{r.changed_cells}</strong> changed cell{r.changed_cells === 1 ? '' : 's'} ·{' '}
      <strong>{r.new_rows}</strong> new row{r.new_rows === 1 ? '' : 's'} ·{' '}
      <strong>{r.discontinued_rows}</strong> discontinued · {r.unchanged_rows} unchanged
      {r.ignored_columns.length > 0 && (
        <span className="text-gray-500">
          {' '}
          (ignored columns: {r.ignored_columns.join(', ')})
        </span>
      )}
    </span>
  )
}

export function BudgetProposalPanel({
  i,
  table,
  book,
  rows,
}: {
  i: number
  table: string
  book: GoverningBook
  // CoercedRow-shaped: plain objects keyed by target column names.
  rows: object[]
}) {
  const [reason, setReason] = useState('')
  const [discontinueMissing, setDiscontinueMissing] = useState(false)
  const [effectiveFrom, setEffectiveFrom] = useState(book.measures[0] ?? '')
  const [preview, setPreview] = useState<ProposalReport | null>(null)
  const [result, setResult] = useState<ProposalReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(dryRun: boolean) {
    setBusy(true)
    setError(null)
    try {
      const report = await api.post<ProposalReport>(
        `/api/table/${encodeURIComponent(table)}:import_proposal`,
        {
          rows,
          reason: reason.trim(),
          ...(dryRun ? { dry_run: true } : {}),
          ...(discontinueMissing
            ? { missing_rows: 'discontinue', effective_from: effectiveFrom }
            : {}),
        },
      )
      if (dryRun) setPreview(report)
      else setResult(report)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The proposal call failed')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="mt-2 border-t border-gray-100 pt-2 text-sm" data-testid={`iw-gov-result-${i}`}>
        <span className="text-green-700">
          Created {result.changes.length} draft Budget Change
          {result.changes.length === 1 ? '' : 's'} — <DiffSummary i={i} r={result} />. Nothing is
          applied until they are approved.
        </span>
        <ul className="mt-1 list-inside list-disc">
          {result.changes.map((c) => (
            <li key={String(c.row_id)}>
              <a
                href={`/admin/${encodeURIComponent('Budget Change')}/${encodeURIComponent(String(c.row_id))}`}
                className="text-[var(--color-brand)] underline"
                data-testid={`iw-gov-draft-${i}-${String(c.row_id)}`}
              >
                {String(c.row_id)}
              </a>{' '}
              <span className="text-gray-500">
                — {TYPE_WORDS[c.change_type] ?? c.change_type},{' '}
                {typeof c.lines === 'number' ? c.lines : c.lines.length} line
                {(typeof c.lines === 'number' ? c.lines : c.lines.length) === 1 ? '' : 's'}
              </span>
            </li>
          ))}
          {result.changes.length === 0 && (
            <li className="list-none text-gray-500">
              The file matches the budget exactly — there is nothing to propose.
            </li>
          )}
        </ul>
      </div>
    )
  }

  return (
    <div className="mt-2 border-t border-gray-100 pt-2" data-testid={`iw-gov-panel-${i}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor={`iw-gov-reason-${i}`} className="fc-label m-0">
          Reason
        </label>
        <input
          id={`iw-gov-reason-${i}`}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            setPreview(null)
          }}
          placeholder="e.g. August reforecast"
          data-testid={`iw-gov-reason-${i}`}
          className="fc-input w-64 py-1"
        />
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={discontinueMissing}
            onChange={(e) => {
              setDiscontinueMissing(e.target.checked)
              setPreview(null)
            }}
            data-testid={`iw-gov-missing-${i}`}
          />
          discontinue rows missing from the file
        </label>
        {discontinueMissing && (
          <label className="flex items-center gap-1 text-sm">
            from
            <select
              value={effectiveFrom}
              onChange={(e) => {
                setEffectiveFrom(e.target.value)
                setPreview(null)
              }}
              data-testid={`iw-gov-effective-${i}`}
              className="rounded border border-gray-200 px-1 py-0.5"
            >
              {book.measures.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {preview && (
        <p className="mt-1 text-sm" data-testid={`iw-gov-preview-result-${i}`}>
          Will draft <strong>{preview.changes.length}</strong> Budget Change
          {preview.changes.length === 1 ? '' : 's'}: <DiffSummary i={i} r={preview} />
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => void call(true)}
          disabled={busy || !reason.trim() || rows.length === 0}
          data-testid={`iw-gov-preview-${i}`}
          className="fc-btn disabled:opacity-40"
        >
          Preview proposals
        </button>
        <button
          onClick={() => void call(false)}
          disabled={busy || !reason.trim() || rows.length === 0}
          data-testid={`iw-gov-create-${i}`}
          className="fc-btn-primary disabled:opacity-40"
        >
          Create draft changes
        </button>
        {!reason.trim() && (
          <span className="text-xs text-gray-400">every proposal carries a reason</span>
        )}
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-600" data-testid={`iw-gov-error-${i}`}>
          {error}
        </p>
      )}
    </div>
  )
}
