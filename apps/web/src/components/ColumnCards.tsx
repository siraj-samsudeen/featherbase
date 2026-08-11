// #151: the builder's cards view — one card per column, the type as
// friendly chips, and the type-specific detail control labelled inside the
// card. Shares the grid view's column state; the grid remains the power
// view (full engine type list), the cards speak spreadsheet.
import { useQuery } from '@tanstack/react-query'
import { listResource } from '../lib/api'
import { BuilderColumn, ColumnVerdict, slugify } from '../lib/column-rules'

// The engine's types behind words a spreadsheet user already has. Types the
// cards don't offer (Sub-table, layout breaks, …) still render as a raw
// chip when a column carries one, so switching views never loses state.
const FRIENDLY: { type: string; label: string; hint?: string }[] = [
  { type: 'Data', label: 'Text' },
  { type: 'Text', label: 'Long text' },
  { type: 'Int', label: 'Number' },
  { type: 'Float', label: 'Decimal' },
  { type: 'Currency', label: 'Money' },
  { type: 'Date', label: 'Date' },
  { type: 'Datetime', label: 'Date & time' },
  { type: 'Check', label: 'Yes / No' },
  { type: 'Choice', label: 'Pick from a list', hint: 'You define the options' },
  { type: 'Reference', label: 'Link to another table', hint: 'Points at a row elsewhere' },
  { type: 'Attach', label: 'File' },
  { type: 'JSON', label: 'JSON' },
]

export function ColumnCards({
  columns,
  verdicts,
  onPatch,
  onRemove,
  onAdd,
}: {
  columns: BuilderColumn[]
  verdicts: (ColumnVerdict | null)[]
  onPatch: (i: number, p: Partial<BuilderColumn>) => void
  onRemove: (i: number) => void
  onAdd: () => void
}) {
  const { data: tables } = useQuery({
    queryKey: ['tables'],
    queryFn: () =>
      listResource<{ name: string }>('Table', {
        filters: [['kind', '!=', 'sub_table']],
        fields: ['name'],
        limit_page_length: 500,
      }),
  })

  return (
    <div className="space-y-3">
      {columns.map((c, i) => {
        const verdict = verdicts[i]
        const known = FRIENDLY.some((f) => f.type === c.column_type)
        return (
          <div key={i} className="fc-card p-5" data-testid={`dt-card-${i}`}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                Column {i + 1}
              </span>
              {columns.length > 1 && (
                <button
                  aria-label="Remove column"
                  onClick={() => onRemove(i)}
                  className="rounded px-1.5 text-sm text-[var(--color-ink-faint)] transition hover:bg-[var(--color-subtle)] hover:text-[var(--color-danger)]"
                >
                  ✕
                </button>
              )}
            </div>

            <input
              value={c.label}
              onChange={(e) =>
                onPatch(i, {
                  label: e.target.value,
                  ...(c.name_touched ? {} : { column_name: slugify(e.target.value) }),
                })
              }
              placeholder="e.g. Date of Birth"
              className="fc-input mb-4 text-base font-medium"
            />

            <label className="fc-label">Type</label>
            <div className="mb-1 flex flex-wrap gap-1.5">
              {FRIENDLY.map((f) => (
                <button
                  key={f.type}
                  title={f.hint}
                  onClick={() => onPatch(i, { column_type: f.type, target: '' })}
                  className={`fc-pill border px-3 py-1 transition ${
                    c.column_type === f.type
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
                      : 'border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              {!known && (
                <span className="fc-pill border border-[var(--color-brand)] bg-[var(--color-brand)]/10 px-3 py-1 text-[var(--color-brand)]">
                  {c.column_type}
                </span>
              )}
            </div>

            {c.column_type === 'Choice' && (
              <div className="mt-3">
                <label className="fc-label">The options, comma-separated</label>
                <input
                  value={c.target}
                  onChange={(e) => onPatch(i, { target: e.target.value })}
                  placeholder="Small, Medium, Large"
                  className="fc-input"
                />
              </div>
            )}
            {c.column_type === 'Reference' && (
              <div className="mt-3">
                <label className="fc-label">Which table does it link to?</label>
                <select value={c.target} onChange={(e) => onPatch(i, { target: e.target.value })} className="fc-input">
                  <option value="">Choose a table…</option>
                  {(tables?.data ?? []).map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-ink-muted)]">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={c.reqd}
                  onChange={(e) => onPatch(i, { reqd: e.target.checked })}
                  className="accent-[var(--color-brand)]"
                />
                Required
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={c.in_list_view}
                  onChange={(e) => onPatch(i, { in_list_view: e.target.checked })}
                  className="accent-[var(--color-brand)]"
                />
                Show in the list
              </label>
              {c.column_name.trim() && !verdict && (
                <span
                  className="ml-auto font-mono text-xs text-[var(--color-ink-faint)]"
                  title="How it's stored in the database — derived from the label"
                >
                  stored as {c.column_name}
                </span>
              )}
            </div>

            {verdict && c.column_name.trim() && (
              <p className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-danger-tint)] px-3 py-2 text-xs text-[var(--color-danger)]">
                {verdict.error}
                {verdict.fix && (
                  <>
                    {' '}
                    <button
                      onClick={() => onPatch(i, { column_name: verdict.fix, name_touched: true })}
                      className="font-semibold underline"
                    >
                      Use “{verdict.fix}”
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        )
      })}
      <button onClick={onAdd} className="fc-btn" data-testid="dt-card-add">
        + Add a column
      </button>
    </div>
  )
}
