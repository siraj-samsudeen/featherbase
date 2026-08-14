import { useQuery } from '@tanstack/react-query'
import { api, listResource } from '../lib/api'

// Spec 0007 M2: the compare view — pick a Budget Book and two anchors
// (snapshots, or the live table via "Current") and see every line that
// differs, measure by measure. Deltas colour by direction; added/removed
// lines are badged. Every anchor is server-computed (/api/budget/compare).

type Row = Record<string, unknown>

interface CompareResult {
  book: string
  from_label: string
  to_label: string
  measure_columns: string[]
  lines: {
    ref_name: string
    key: Record<string, unknown>
    status: 'added' | 'removed' | 'changed'
    measures: Record<string, { from: number | null; to: number | null }>
  }[]
  unchanged: number
}

const fmt = (v: number | null) =>
  v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 })

export function BudgetCompare({
  book,
  from,
  to,
  onPick,
}: {
  book?: string
  from?: string
  to?: string
  onPick: (next: { book?: string; from?: string; to?: string }) => void
}) {
  const books = useQuery({
    queryKey: ['budget-compare-books'],
    queryFn: () => listResource<Row>('Budget Book', { fields: ['name', 'lifecycle'] }),
  })
  const versions = useQuery({
    queryKey: ['budget-compare-versions', book],
    enabled: Boolean(book),
    queryFn: () =>
      listResource<Row>('Budget Version', {
        filters: [['book', '=', book]],
        fields: ['name', 'label', 'kind', 'created_at'],
        order_by: 'created_at asc',
      }),
  })
  const result = useQuery({
    queryKey: ['budget-compare', book, from, to],
    enabled: Boolean(book && from && to),
    queryFn: () =>
      api.get<CompareResult>(
        `/api/budget/compare/${encodeURIComponent(book!)}?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`,
      ),
  })

  const versionOptions = [
    ...(versions.data?.data ?? []).map((v) => ({
      value: String(v.name),
      label: `${String(v.label)} (${String(v.kind)})`,
    })),
    { value: 'current', label: 'Current' },
  ]

  return (
    <div data-testid="budget-compare" className="max-w-6xl">
      <h1 className="mb-3 text-xl font-semibold text-[var(--color-ink)]">Budget compare</h1>
      <div className="fc-card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs text-[var(--color-ink-muted)]">
          Book
          <select
            value={book ?? ''}
            onChange={(e) => onPick({ book: e.target.value || undefined, from: undefined, to: undefined })}
            data-testid="compare-book"
            className="fc-input mt-1 block w-56"
          >
            <option value="">Pick a book…</option>
            {(books.data?.data ?? []).map((b) => (
              <option key={String(b.name)} value={String(b.name)}>
                {String(b.name)} ({String(b.lifecycle)})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-ink-muted)]">
          From
          <select
            value={from ?? ''}
            onChange={(e) => onPick({ book, from: e.target.value || undefined, to })}
            disabled={!book}
            data-testid="compare-from"
            className="fc-input mt-1 block w-48"
          >
            <option value="">Pick…</option>
            {versionOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-ink-muted)]">
          To
          <select
            value={to ?? ''}
            onChange={(e) => onPick({ book, from, to: e.target.value || undefined })}
            disabled={!book}
            data-testid="compare-to"
            className="fc-input mt-1 block w-48"
          >
            <option value="">Pick…</option>
            {versionOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {result.isError && (
        <p className="text-sm text-[var(--color-danger)]" data-testid="compare-error">
          Cannot compare those anchors.
        </p>
      )}
      {result.data && (
        <div className="fc-card overflow-x-auto p-4" data-testid="compare-result">
          <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
            <strong>{result.data.from_label}</strong> ⇄ <strong>{result.data.to_label}</strong> ·{' '}
            {result.data.lines.length} line{result.data.lines.length === 1 ? '' : 's'} differ ·{' '}
            {result.data.unchanged} unchanged
          </p>
          <table className="w-full text-sm" data-testid="compare-table">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase text-[var(--color-ink-muted)]">
                <th className="py-1 pr-3">Line</th>
                <th className="py-1 pr-3">Status</th>
                {result.data.measure_columns.map((m) => (
                  <th key={m} className="py-1 pr-3 text-right">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.data.lines.map((l) => (
                <tr key={l.ref_name} className="border-b border-[var(--color-line)]" data-testid="compare-line">
                  <td className="py-1.5 pr-3">
                    {Object.values(l.key).map(String).join(' · ') || l.ref_name}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span
                      className={`fc-pill ${
                        l.status === 'added'
                          ? 'bg-[var(--color-good-tint)] text-[var(--color-good)]'
                          : l.status === 'removed'
                            ? 'bg-[var(--color-danger-tint)] text-[var(--color-danger)]'
                            : 'bg-[var(--color-subtle)] text-[var(--color-ink-muted)]'
                      }`}
                    >
                      {l.status}
                    </span>
                  </td>
                  {result.data!.measure_columns.map((m) => {
                    const cell = l.measures[m]
                    const changed = cell && cell.from !== cell.to
                    return (
                      <td key={m} className="py-1.5 pr-3 text-right tabular-nums">
                        {changed ? (
                          <span>
                            <span className="text-[var(--color-ink-muted)] line-through">
                              {fmt(cell.from)}
                            </span>{' '}
                            <span
                              className={
                                (cell.to ?? 0) >= (cell.from ?? 0)
                                  ? 'font-semibold text-[var(--color-good)]'
                                  : 'font-semibold text-[var(--color-danger)]'
                              }
                            >
                              {fmt(cell.to)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[var(--color-ink-muted)]">{fmt(cell?.to ?? null)}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
