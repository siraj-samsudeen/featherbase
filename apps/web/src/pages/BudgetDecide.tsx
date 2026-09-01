import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api, listResource } from '../lib/api'
import { formatScope } from '../lib/budget-scope'

// Spec 0007 M4 (BUD-R14/R15/R16) — the decision desk of an append_decisions
// Budget Book.
//
// In this mode the bound table is a read-only MODEL: approving a change
// writes nothing into it and appends an immutable Budget Decision beside it.
// Two things follow that the generic FormView cannot give a person:
//
//  1. A decision may address a SCOPE — declared key columns mapped to
//     values, an absent dimension meaning "all" (BUD-R15). The engine stores
//     that object and never expands it, so the ONLY place a human states or
//     reads one is here. Asking them to type {"region":"Kerala"} into a JSON
//     column is not a user interface; every dimension gets a control, and
//     "all" is a thing you choose, never a box you left empty.
//  2. The ledger is the book's actual output. It is append-only (BUD-R16),
//     so it is a reading surface, not an editing one.
//
// Composing a decision creates an ordinary DRAFT Budget Change with one
// line; approval rides the existing lanes (BUD-R5/R11) — there is no second
// approval path here, deliberately.

type Row = Record<string, unknown>

interface BookDoc {
  row_id: string
  ref_table?: string
  lifecycle?: string
  mode?: string
  model_version?: string | null
  key_columns?: { column_name: string }[]
  measure_columns?: { column_name: string; period_label?: string | null }[]
}

interface DecisionRow {
  row_id: string
  change: string
  target_kind: string
  line_ref: string | null
  scope: unknown
  measure: string
  basis: string
  value: number
  model_version: string | null
  reason: string
  decided_by: string
  decided_role: string | null
  decided_at: string
}

const DECISION_FIELDS = [
  'row_id',
  'change',
  'target_kind',
  'line_ref',
  'scope',
  'measure',
  'basis',
  'value',
  'model_version',
  'reason',
  'decided_by',
  'decided_role',
  'decided_at',
]

const T = encodeURIComponent
const changeHref = (name: string) => `/admin/${T('Budget Change')}/${T(name)}`

const fmtValue = (v: unknown) =>
  Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })

// 'set' and 'delta' in the words a budget owner uses, not the engine's. The
// distinction decides what the number below MEANS, so it is spelled out
// beside the choice rather than left to the reader's memory.
const BASIS_WORDS: Record<string, string> = {
  set: 'Set — the measure becomes this number, whatever the model says.',
  delta: 'Delta — this number is added to what the model says (negative takes it off).',
}

export function BudgetDecide({
  book,
  lineRef,
  onPick,
}: {
  book?: string
  lineRef?: string
  onPick: (next: { book?: string; line_ref?: string }) => void
}) {
  // Only append-mode books have a decision desk; a mutate_rows book's road
  // is the Budget Change form and the compare view.
  const books = useQuery({
    queryKey: ['budget-decide-books'],
    queryFn: () =>
      listResource<Row>('Budget Book', {
        filters: [['mode', '=', 'append_decisions']],
        fields: ['row_id', 'lifecycle', 'model_version'],
        order_by: 'row_id asc',
      }),
  })
  const doc = useQuery({
    queryKey: ['budget-decide-book', book],
    enabled: Boolean(book),
    queryFn: () => api.get<BookDoc>(`/api/table/${T('Budget Book')}/${T(book!)}`),
  })

  const keyColumns = (doc.data?.key_columns ?? []).map((k) => k.column_name)
  const measureColumns = (doc.data?.measure_columns ?? []).map((m) => m.column_name)

  return (
    <div data-testid="budget-decide" className="max-w-6xl">
      <h1 className="mb-1 text-xl font-semibold text-[var(--color-ink)]">Budget decisions</h1>
      <p className="mb-3 text-sm text-[var(--color-ink-muted)]" data-testid="budget-decide-intro">
        A book in append mode records decisions beside its model table. The model is read-only: an
        approved decision is recorded next to it and never written into it.
      </p>

      <div className="fc-card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs text-[var(--color-ink-muted)]">
          Book
          <select
            value={book ?? ''}
            onChange={(e) => onPick({ book: e.target.value || undefined, line_ref: undefined })}
            data-testid="budget-decide-book"
            className="fc-input mt-1 block w-56"
          >
            <option value="">Pick a book…</option>
            {(books.data?.data ?? []).map((b) => (
              <option key={String(b.row_id)} value={String(b.row_id)}>
                {String(b.row_id)} ({String(b.lifecycle)})
              </option>
            ))}
          </select>
        </label>
        {doc.data && (
          <span className="text-xs text-[var(--color-ink-muted)]" data-testid="budget-decide-anchor">
            Model: {String(doc.data.ref_table ?? '—')} · version{' '}
            {doc.data.model_version ? String(doc.data.model_version) : 'unstated'}
          </span>
        )}
      </div>

      {doc.data && (
        <>
          <DecisionComposer
            key={`${book}/${lineRef ?? ''}`}
            book={book!}
            refTable={String(doc.data.ref_table ?? '')}
            keyColumns={keyColumns}
            measureColumns={measureColumns}
            lineRef={lineRef}
          />
          <DecisionLedger book={book!} keyColumns={keyColumns} />
        </>
      )}
    </div>
  )
}

function DecisionComposer({
  book,
  refTable,
  keyColumns,
  measureColumns,
  lineRef,
}: {
  book: string
  refTable: string
  keyColumns: string[]
  measureColumns: string[]
  lineRef?: string
}) {
  const [target, setTarget] = useState<'row' | 'scope'>(lineRef ? 'row' : 'scope')
  // Per dimension: 'all' (absent from the stored scope) or 'is' + a value.
  // The two are separate state so that switching to All never silently keeps
  // a typed value in play — what you see is what is sent.
  const [dimOpen, setDimOpen] = useState<Record<string, boolean>>({})
  const [dimValue, setDimValue] = useState<Record<string, string>>({})
  const [measure, setMeasure] = useState(measureColumns[0] ?? '')
  const [basis, setBasis] = useState<'set' | 'delta'>('set')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)

  const scope: Record<string, string> = {}
  for (const c of keyColumns)
    if (dimOpen[c] && dimValue[c]?.trim()) scope[c] = dimValue[c].trim()
  const namedDims = Object.keys(scope).length

  const numeric = value.trim() !== '' && Number.isFinite(Number(value))
  // The client refuses what BUD-R15 refuses, before the round trip: a scope
  // with every dimension left open addresses the whole book, and must be
  // said deliberately rather than arrived at by leaving the form alone.
  const targetOk = target === 'row' ? Boolean(lineRef) : namedDims > 0
  const canSave = Boolean(reason.trim()) && numeric && Boolean(measure) && targetOk && !busy

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const line =
        target === 'row'
          ? { target_kind: 'row', line_ref: lineRef, measure_column: measure, basis, proposed_value: Number(value) }
          : { target_kind: 'scope', scope, measure_column: measure, basis, proposed_value: Number(value) }
      const draft = await api.post<{ row_id: string }>(`/api/table/${T('Budget Change')}`, {
        book,
        change_type: 'revise',
        reason: reason.trim(),
        lines: [line],
      })
      setCreated(String(draft.row_id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The decision could not be drafted')
    } finally {
      setBusy(false)
    }
  }

  if (created)
    return (
      <div className="fc-card mb-4 p-4" data-testid="budget-decision-result">
        <p className="text-sm">
          Drafted{' '}
          <a href={changeHref(created)} className="text-[var(--color-brand)] underline" data-testid="budget-decision-draft">
            {created}
          </a>{' '}
          — one decision, still a draft. Nothing is recorded until it is approved, and approval
          appends it beside {refTable || 'the model'} rather than into it.
        </p>
        <button
          onClick={() => {
            setCreated(null)
            setValue('')
            setReason('')
          }}
          data-testid="budget-decision-again"
          className="fc-btn mt-3"
        >
          Compose another
        </button>
      </div>
    )

  return (
    <div className="fc-card mb-4 p-4" data-testid="budget-decision-composer">
      <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">Propose a decision</h2>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="fc-label m-0">Addresses</span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as 'row' | 'scope')}
          data-testid="budget-decision-target"
          className="fc-input w-56"
        >
          {lineRef && <option value="row">This row ({lineRef})</option>}
          <option value="scope">A scope — many rows at once</option>
        </select>
        {!lineRef && (
          <span className="text-xs text-[var(--color-ink-muted)]" data-testid="budget-decision-target-note">
            Open a model row to decide about that one row.
          </span>
        )}
      </div>

      {target === 'scope' && (
        <div className="mb-3" data-testid="budget-scope-builder">
          <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
            One decision, counted once — the scope is stored as you state it and is never expanded
            to the rows underneath.
          </p>
          {keyColumns.map((c) => (
            <div key={c} className="mb-1 flex flex-wrap items-center gap-2" data-testid={`budget-scope-dim-${c}`}>
              <span className="fc-label m-0 w-36">{c}</span>
              <select
                value={dimOpen[c] ? 'is' : 'all'}
                onChange={(e) => setDimOpen({ ...dimOpen, [c]: e.target.value === 'is' })}
                data-testid={`budget-scope-mode-${c}`}
                className="fc-input w-32"
              >
                <option value="all">All</option>
                <option value="is">Is…</option>
              </select>
              {dimOpen[c] ? (
                <input
                  value={dimValue[c] ?? ''}
                  onChange={(e) => setDimValue({ ...dimValue, [c]: e.target.value })}
                  placeholder={`one ${c}`}
                  data-testid={`budget-scope-value-${c}`}
                  className="fc-input w-56"
                />
              ) : (
                <span className="text-xs text-[var(--color-ink-muted)]">
                  every {c} — this dimension is left open
                </span>
              )}
            </div>
          ))}
          <p className="mt-2 text-xs" data-testid="budget-scope-summary">
            Reaches: <strong>{formatScope(scope, keyColumns)}</strong>
          </p>
          {namedDims === 0 && (
            <p className="mt-1 text-xs text-[var(--color-danger)]" data-testid="budget-scope-too-wide">
              Every dimension is open, which is the whole book — name at least one.
            </p>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--color-ink-muted)]">
          Measure
          <select
            value={measure}
            onChange={(e) => setMeasure(e.target.value)}
            data-testid="budget-decision-measure"
            className="fc-input mt-1 block w-48"
          >
            {measureColumns.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-ink-muted)]">
          Basis
          <select
            value={basis}
            onChange={(e) => setBasis(e.target.value as 'set' | 'delta')}
            data-testid="budget-decision-basis"
            className="fc-input mt-1 block w-40"
          >
            <option value="set">Set</option>
            <option value="delta">Delta</option>
          </select>
        </label>
        <label className="text-xs text-[var(--color-ink-muted)]">
          Value
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="budget-decision-value"
            className="fc-input mt-1 block w-40"
          />
        </label>
      </div>
      <p className="mb-3 text-xs text-[var(--color-ink-muted)]" data-testid="budget-basis-help">
        {BASIS_WORDS[basis]}
      </p>

      <div className="mb-3">
        <label htmlFor="budget-decision-reason" className="fc-label">
          Reason
        </label>
        <input
          id="budget-decision-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Regional push agreed with the CFO"
          data-testid="budget-decision-reason"
          className="fc-input w-full max-w-xl"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={!canSave}
          data-testid="budget-decision-save"
          className="fc-btn-primary disabled:opacity-40"
        >
          Draft this decision
        </button>
        {!reason.trim() && (
          <span className="text-xs text-[var(--color-ink-muted)]">every decision carries a reason</span>
        )}
      </div>
      {error && (
        <p className="mt-2 text-sm text-[var(--color-danger)]" data-testid="budget-decision-error">
          {error}
        </p>
      )}
    </div>
  )
}

// BUD-R16: the ledger is append-only, so this is a reading surface — newest
// first, because the standing judgment is the one a reader came for, and a
// superseded one stays visible underneath rather than being overwritten.
const LEDGER_PAGE = 50

function DecisionLedger({ book, keyColumns }: { book: string; keyColumns: string[] }) {
  const led = useQuery({
    queryKey: ['budget-ledger', book],
    queryFn: () =>
      listResource<DecisionRow>('Budget Decision', {
        filters: [['book', '=', book]],
        fields: DECISION_FIELDS,
        // Newest first, by a key that cannot tie: ONE approval appends every
        // one of its lines in a single transaction, so those decisions share
        // `decided_at` to the microsecond and ordering by it alone leaves
        // their order to the planner. The BDC series only ever increases, so
        // row_id IS append order — and it is a total order.
        order_by: 'row_id desc',
        limit_page_length: LEDGER_PAGE,
      }),
  })
  const rows = led.data?.data ?? []
  // The count comes from the server's total, never from the page in hand:
  // a heading that counts the rows it happens to be showing would report 50
  // for a book with a thousand decisions, and read as the truth.
  const total = led.data?.total ?? rows.length
  return (
    <div className="fc-card overflow-x-auto p-4" data-testid="budget-ledger">
      <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]" data-testid="budget-ledger-count">
        Decision ledger · {total} recorded
        {rows.length < total && ` · showing the latest ${rows.length}`}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="budget-ledger-empty">
          No decision has been appended to this book yet — approve a draft and it lands here.
        </p>
      ) : (
        <table className="w-full text-sm" data-testid="budget-ledger-table">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase text-[var(--color-ink-muted)]">
              <th className="py-1 pr-3">Target</th>
              <th className="py-1 pr-3">Measure</th>
              <th className="py-1 pr-3">Basis</th>
              <th className="py-1 pr-3 text-right">Value</th>
              <th className="py-1 pr-3">Model</th>
              <th className="py-1 pr-3">Decided by</th>
              <th className="py-1 pr-3">Reason</th>
              <th className="py-1 pr-3">From</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.row_id} className="border-b border-[var(--color-line)]" data-testid="budget-ledger-row">
                <td className="py-1.5 pr-3" data-testid={`budget-ledger-target-${d.row_id}`}>
                  <span
                    className={`fc-pill mr-2 ${
                      d.target_kind === 'scope'
                        ? 'bg-[var(--color-brand-tint)] text-[var(--color-brand)]'
                        : 'bg-[var(--color-subtle)] text-[var(--color-ink-muted)]'
                    }`}
                  >
                    {d.target_kind}
                  </span>
                  {d.target_kind === 'scope' ? formatScope(d.scope, keyColumns) : String(d.line_ref ?? '')}
                </td>
                <td className="py-1.5 pr-3">{d.measure}</td>
                <td className="py-1.5 pr-3">{d.basis}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{fmtValue(d.value)}</td>
                <td className="py-1.5 pr-3 text-[var(--color-ink-muted)]">
                  {d.model_version ?? '—'}
                </td>
                <td className="py-1.5 pr-3">{d.decided_by}</td>
                <td className="py-1.5 pr-3">{d.reason}</td>
                <td className="py-1.5 pr-3">
                  <a href={changeHref(d.change)} className="text-[var(--color-brand)] underline">
                    {d.change}
                  </a>
                  {/* The decision's own id — what an auditor cites, and the
                      only handle for one line of a many-line approval. */}
                  <span className="block text-xs text-[var(--color-ink-muted)]">{d.row_id}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
