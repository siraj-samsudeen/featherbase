import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'

// RPT-004: renders an admin-authored Query Report. The SQL itself never
// reaches the client — we fetch only the filter names, collect values, and POST
// them to be bound as parameters server-side.

interface QueryReportMeta {
  name: string
  ref_doctype: string | null
  filters: string[]
}
interface RunResult {
  columns: string[]
  rows: Record<string, unknown>[]
}

function inputType(filter: string): string {
  return /date/i.test(filter) ? 'date' : 'text'
}

export function QueryReportView({ name }: { name: string }) {
  const meta = useQuery({
    queryKey: ['query-report', name],
    queryFn: () => api.get<QueryReportMeta>(`/api/query_report/${encodeURIComponent(name)}`),
  })
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const filters: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(values)) if (v !== '') filters[k] = v
      setResult(await api.post<RunResult>('/api/run_query_report', { report: name, filters }))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to run report')
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  // Run once the metadata is loaded so the report shows immediately.
  useEffect(() => {
    if (meta.data) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.data?.name])

  if (meta.isError)
    return (
      <div className="fc-card p-4 text-sm text-red-600" data-testid="query-report-error">
        {meta.error instanceof ApiError ? meta.error.message : 'Report not found'}
      </div>
    )
  if (!meta.data) return <div className="p-4 text-[var(--color-ink-faint)]">Loading…</div>

  return (
    <div data-testid="query-report" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-ink)]" data-testid="query-report-title">
          {meta.data.name}
        </h1>
      </div>

      {meta.data.filters.length > 0 && (
        <div className="fc-card flex flex-wrap items-end gap-3 p-3" data-testid="query-report-filters">
          {meta.data.filters.map((f) => (
            <div key={f}>
              <label className="fc-label">{f}</label>
              <input
                className="fc-input"
                type={inputType(f)}
                data-testid={`filter-${f}`}
                value={values[f] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
              />
            </div>
          ))}
          <button className="fc-btn fc-btn-primary" data-testid="query-report-run" onClick={() => void run()}>
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      )}

      {error && (
        <div className="fc-card p-3 text-sm text-red-600" data-testid="query-report-run-error">
          {error}
        </div>
      )}

      {result && (
        <div className="fc-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-ink-muted)]">
                {result.columns.map((c) => (
                  <th key={c} className="px-3 py-2 font-medium" data-testid={`qr-col-${c}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody data-testid="query-report-rows">
              {result.rows.map((row, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  {result.columns.map((c) => (
                    <td key={c} className="px-3 py-2 text-[var(--color-ink)]">
                      {row[c] == null ? '—' : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
              {!result.rows.length && (
                <tr>
                  <td
                    colSpan={result.columns.length || 1}
                    className="px-3 py-8 text-center text-[var(--color-ink-faint)]"
                    data-testid="query-report-empty"
                  >
                    No rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
