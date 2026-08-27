// #208 (issue #197): merge one Table into another, after the fact.
//
// "Suppose I imported two things and then I realized they are exactly the
// same columns but the names are, for example, in one of the things floor
// was spelled with a G, Glor... select one table and say merge into other
// table."
//
// A post-hoc merge IS an import whose source happens to be another Table
// rather than a file, so it goes through `sendImportRun` like every other
// import. That is not a shortcut — it is what gives the merge the things a
// merge most needs and would otherwise have to reinvent: chunking, per-row
// failure reporting, an Import Log entry, and a run that can be REVERTED.
//
// Q5 (owner decision): nothing is guessed. Columns pair only when their names
// fold to the same thing — case, spaces, punctuation. `Glor` and `Floor` do
// not fold together and never will; the user says that one, which is the
// whole point of the screen.
import { useMemo, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { coerceRows, sanitizeColumnName } from 'shared'
import { ApiError, api, listResource } from '../lib/api'
import { type TableMeta } from '../lib/meta'
import { sendImportRun, type ImportFailure } from '../lib/import-run'

// Columns a merge can carry: real storage, and not the platform's own.
const SKIP_TYPES = ['Section Break', 'Column Break', 'Sub-table']
const STANDARD = [
  'row_id',
  'created_by',
  'created_at',
  'updated_at',
  'updated_by',
  'status',
  'position',
  'parent',
  'parenttype',
  'parentfield',
]

const mergeable = (meta: TableMeta) =>
  meta.columns.filter((c) => !SKIP_TYPES.includes(c.column_type) && !STANDARD.includes(c.column_name))

const SAMPLE_ROWS = 3
const MAX_ROWS = 5000

interface Outcome {
  inserted: number
  failed: ImportFailure[]
  runId: string
}

export function TableMerge() {
  const { table: source } = useParams({ strict: false }) as { table: string }
  const queryClient = useQueryClient()
  const [target, setTarget] = useState('')
  // Source column name -> target column name, or '' for "leave it behind".
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const tables = useQuery({
    queryKey: ['tables'],
    queryFn: () => listResource<{ row_id: string }>('Table', { limit_page_length: 500 }),
  })
  const sourceMeta = useQuery({
    queryKey: ['meta', source],
    queryFn: () => api.get<TableMeta>(`/api/table/${encodeURIComponent(source)}:meta`),
  })
  const targetMeta = useQuery({
    queryKey: ['meta', target],
    enabled: Boolean(target),
    queryFn: () => api.get<TableMeta>(`/api/table/${encodeURIComponent(target)}:meta`),
  })

  const sourceColumns = sourceMeta.data ? mergeable(sourceMeta.data) : []
  const targetColumns = targetMeta.data ? mergeable(targetMeta.data) : []

  // A few real values per column, so "are these the same thing?" is answered
  // from the data rather than guessed from two names that, by definition, do
  // not look alike.
  const samples = useQuery({
    queryKey: ['merge-sample', source, sourceColumns.map((c) => c.column_name).join(',')],
    enabled: sourceColumns.length > 0,
    queryFn: () =>
      api.get<{ data: Record<string, unknown>[] }>(
        `/api/table/${encodeURIComponent(source)}?fields=${encodeURIComponent(
          JSON.stringify(sourceColumns.map((c) => c.column_name)),
        )}&limit_page_length=${SAMPLE_ROWS}`,
      ),
  })

  const rowCount = useQuery({
    queryKey: ['merge-count', source],
    queryFn: () => api.get<{ count: number }>(`/api/table/${encodeURIComponent(source)}:count`),
  })

  // Folding is the ONLY pairing rule. Anything it cannot join stays apart
  // until the user says otherwise (Q5 — no guessing).
  const folded = useMemo(() => {
    if (!targetColumns.length) return {}
    const byFold = new Map<string, string>()
    for (const c of targetColumns) byFold.set(sanitizeColumnName(c.column_name), c.column_name)
    const out: Record<string, string> = {}
    for (const c of sourceColumns) {
      const hit = byFold.get(sanitizeColumnName(c.column_name))
      if (hit) out[c.column_name] = hit
    }
    return out
  }, [sourceColumns, targetColumns])

  // The proposal until the user edits it; their edits win from then on.
  const effective = touched ? mapping : folded
  const mapped = Object.entries(effective).filter(([, to]) => to)
  const unmapped = sourceColumns.filter((c) => !effective[c.column_name])

  function setOne(from: string, to: string) {
    setTouched(true)
    setMapping({ ...effective, [from]: to })
  }

  function sampleOf(column: string): string {
    const values = (samples.data?.data ?? [])
      .map((r) => r[column])
      .filter((v) => v !== null && v !== undefined && v !== '')
      .map((v) => String(v))
    return values.length ? values.slice(0, SAMPLE_ROWS).join(', ') : '(no values)'
  }

  async function merge() {
    if (!targetMeta.data || !mapped.length) return
    setError(null)
    setOutcome(null)
    setBusy('Reading rows…')
    try {
      const froms = mapped.map(([from]) => from)
      const tos = mapped.map(([, to]) => to)
      const page = await api.get<{ data: Record<string, unknown>[]; total: number }>(
        `/api/table/${encodeURIComponent(source)}?fields=${encodeURIComponent(
          JSON.stringify(froms),
        )}&limit_page_length=${MAX_ROWS}`,
      )
      if (page.total > MAX_ROWS) {
        // Said, never silently truncated: a merge that quietly leaves rows
        // behind is worse than one that refuses.
        setError(
          `${source} has ${page.total} rows; this screen merges at most ${MAX_ROWS} at a time.`,
        )
        setBusy(null)
        return
      }
      const typeOf = new Map(targetColumns.map((c) => [c.column_name, c.column_type]))
      // Coerced to the TARGET's types — a Data column landing in an Int one
      // has to become an Int or fail saying so, not arrive as a string.
      const rows = coerceRows(
        tos.map((to) => ({ column_name: to, column_type: typeOf.get(to) ?? 'Data' })),
        page.data.map((r) => froms.map((from) => r[from])),
      )
      const runId = crypto.randomUUID()
      const batchId = crypto.randomUUID()
      const report = await sendImportRun({
        table: targetMeta.data.name,
        rows,
        context: (part, parts) => ({
          // Provenance in the language of the Import Log: where these rows
          // came from is a Table, and it says so.
          file_name: `Merged from ${source}`,
          sheet_name: source,
          part,
          parts,
          run_id: runId,
          batch_id: batchId,
        }),
        onChunk: ({ from, to, total }) => setBusy(`Merging rows ${from}–${to} of ${total}…`),
      })
      setOutcome({ inserted: report.inserted, failed: report.failed, runId })
      await queryClient.invalidateQueries({ queryKey: ['import-batches'] })
      await queryClient.invalidateQueries({ queryKey: ['rows'] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Merge failed')
    } finally {
      setBusy(null)
    }
  }

  if (sourceMeta.isError)
    return (
      <p className="text-sm text-[var(--color-danger)]" data-testid="tm-error">
        {sourceMeta.error instanceof ApiError ? sourceMeta.error.message : 'Could not load'}
      </p>
    )

  const candidates = (tables.data?.data ?? [])
    .map((t) => t.row_id)
    .filter((name) => name !== source)

  return (
    <div data-testid="table-merge" className="max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold text-[var(--color-ink)]">
        Merge{' '}
        <Link
          to="/admin/$table"
          params={{ table: source }}
          search={{ filters: undefined }}
          className="underline"
        >
          {source}
        </Link>{' '}
        into another Table
      </h1>
      <p className="mb-4 text-xs text-gray-500">
        Copies {source}&apos;s {rowCount.data?.count ?? '…'} rows into the Table you choose, column
        by column. {source} itself is left alone — delete it afterwards if you no longer want it.
      </p>

      <div className="fc-card mb-3 p-3">
        <label className="fc-label m-0">
          Merge into
          <select
            className="fc-input ml-2 w-64 py-1"
            data-testid="tm-target"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value)
              // A different target is a different set of columns; the old
              // pairing means nothing against it.
              setTouched(false)
              setMapping({})
              setOutcome(null)
            }}
          >
            <option value="">— choose a Table —</option>
            {candidates.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {target && targetMeta.data && (
        <div className="fc-card mb-3 p-3" data-testid="tm-mapping">
          <div className="fc-label mb-1">Columns</div>
          <p className="mb-2 text-xs text-gray-500">
            Columns whose names match — ignoring case, spaces and punctuation — are paired for you.
            Nothing else is guessed: if <code>Glor</code> and <code>Floor</code> are the same thing,
            only you know that, so say so here.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="py-1">{source} column</th>
                <th>First values</th>
                <th>→ {target} column</th>
              </tr>
            </thead>
            <tbody>
              {sourceColumns.map((column) => (
                <tr
                  key={column.column_name}
                  className="border-t border-[var(--color-border)]"
                  data-testid={`tm-row-${column.column_name}`}
                >
                  <td className="py-1 pr-2">
                    {column.label || column.column_name}{' '}
                    <span className="font-mono text-xs text-gray-400">{column.column_name}</span>
                  </td>
                  <td
                    className="max-w-xs truncate pr-2 text-xs text-gray-500"
                    data-testid={`tm-sample-${column.column_name}`}
                  >
                    {sampleOf(column.column_name)}
                  </td>
                  <td>
                    <select
                      className="fc-input w-56 py-0.5"
                      aria-label={`Target column for ${column.column_name}`}
                      data-testid={`tm-map-${column.column_name}`}
                      value={effective[column.column_name] ?? ''}
                      onChange={(e) => setOne(column.column_name, e.target.value)}
                    >
                      <option value="">— leave this column behind —</option>
                      {targetColumns.map((t) => (
                        <option key={t.column_name} value={t.column_name}>
                          {t.label || t.column_name} · {t.column_name} ({t.column_type})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-2 text-xs text-gray-500" data-testid="tm-tally">
            {mapped.length} of {sourceColumns.length} columns mapped
            {unmapped.length > 0 &&
              `; ${unmapped.map((c) => c.column_name).join(', ')} will be left behind`}
            .
          </p>
          {unmapped.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              Missing a column on {target}?{' '}
              <Link
                to="/admin/$table/columns"
                params={{ table: target }}
                className="underline"
                data-testid="tm-add-column-link"
              >
                Add it there first
              </Link>
              , then come back.
            </p>
          )}
        </div>
      )}

      {busy && (
        <p className="mb-2 text-sm text-gray-500" data-testid="tm-progress">
          {busy}
        </p>
      )}
      {error && (
        <p className="mb-2 text-sm text-[var(--color-danger)]" data-testid="tm-error">
          {error}
        </p>
      )}
      {outcome && (
        <div className="fc-card mb-3 p-3 text-sm" data-testid="tm-outcome">
          <span className={outcome.failed.length ? 'text-red-600' : 'text-green-700'}>
            Merged {outcome.inserted} rows into{' '}
            <Link
              to="/admin/$table"
              params={{ table: target }}
              search={{ filters: undefined }}
              className="underline"
            >
              {target}
            </Link>
            {outcome.failed.length > 0 &&
              `; ${outcome.failed.length} failed (first: row ${outcome.failed[0].sourceIndex + 1}: ${outcome.failed[0].message})`}
            .
          </span>
          <p className="mt-1 text-xs text-gray-500">
            {/* A merge is an import, so it undoes like one. */}
            {source} still has its own rows — this copied them.{' '}
            <Link
              to="/admin/import"
              search={{ table: target }}
              className="underline"
              data-testid="tm-undo-link"
            >
              Undo this merge
            </Link>{' '}
            from {target}&apos;s import history, or{' '}
            <Link
              to="/admin/$table/columns"
              params={{ table: source }}
              className="underline"
            >
              go back to {source}
            </Link>
            .
          </p>
        </div>
      )}

      <button
        type="button"
        className="fc-btn-primary disabled:opacity-40"
        data-testid="tm-go"
        disabled={!!busy || !target || mapped.length === 0}
        onClick={() => void merge()}
      >
        {mapped.length
          ? `Merge ${rowCount.data?.count ?? ''} rows into ${target}`.replace('  ', ' ')
          : 'Map at least one column'}
      </button>
    </div>
  )
}
