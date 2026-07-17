import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'

// RPT-005: renders a server-side script report — its declared filter controls
// and the columns+rows its execute() returns.

interface FilterDef {
  fieldname: string
  label: string
  fieldtype: string
  options?: string
}
interface ScriptReportMeta {
  name: string
  script: string
  filters: FilterDef[]
}
interface RunResult {
  columns: string[]
  rows: Record<string, unknown>[]
}

function FilterControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef
  value: string
  onChange: (v: string) => void
}) {
  const testid = `sr-filter-${def.fieldname}`
  if (def.fieldtype === 'Select') {
    const opts = (def.options ?? '').split('\n')
    return (
      <select className="fc-input" data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)}>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o || '(any)'}
          </option>
        ))}
      </select>
    )
  }
  if (def.fieldtype === 'Check')
    return (
      <input
        type="checkbox"
        data-testid={testid}
        checked={value === '1'}
        onChange={(e) => onChange(e.target.checked ? '1' : '')}
      />
    )
  const type = def.fieldtype === 'Date' ? 'date' : def.fieldtype === 'Int' ? 'number' : 'text'
  return (
    <input
      className="fc-input"
      type={type}
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function ScriptReportView({ name }: { name: string }) {
  const meta = useQuery({
    queryKey: ['script-report', name],
    queryFn: () => api.get<ScriptReportMeta>(`/api/script_report/${encodeURIComponent(name)}`),
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
      for (const [k, v] of Object.entries(values)) if (v !== '') filters[k] = v === '1' ? true : v
      setResult(await api.post<RunResult>('/api/run_script_report', { report: name, filters }))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to run report')
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    if (meta.data) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.data?.name])

  if (meta.isError)
    return (
      <div className="fc-card p-4 text-sm text-red-600" data-testid="script-report-error">
        {meta.error instanceof ApiError ? meta.error.message : 'Report not found'}
      </div>
    )
  if (!meta.data) return <div className="p-4 text-[var(--color-ink-faint)]">Loading…</div>

  return (
    <div data-testid="script-report" className="space-y-4">
      <h1 className="text-lg font-semibold text-[var(--color-ink)]" data-testid="script-report-title">
        {meta.data.name}
      </h1>

      {meta.data.filters.length > 0 && (
        <div className="fc-card flex flex-wrap items-end gap-3 p-3" data-testid="script-report-filters">
          {meta.data.filters.map((f) => (
            <div key={f.fieldname}>
              <label className="fc-label">{f.label}</label>
              <FilterControl
                def={f}
                value={values[f.fieldname] ?? ''}
                onChange={(v) => setValues((s) => ({ ...s, [f.fieldname]: v }))}
              />
            </div>
          ))}
          <button className="fc-btn fc-btn-primary" data-testid="script-report-run" onClick={() => void run()}>
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      )}

      {error && (
        <div className="fc-card p-3 text-sm text-red-600" data-testid="script-report-run-error">
          {error}
        </div>
      )}

      {result && (
        <div className="fc-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-ink-muted)]">
                {result.columns.map((col) => (
                  <th key={col} className="px-3 py-2 font-medium" data-testid={`sr-col-${col}`}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody data-testid="script-report-rows">
              {result.rows.map((row, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  {result.columns.map((col) => (
                    <td key={col} className="px-3 py-2 text-[var(--color-ink)]">
                      {row[col] == null ? '—' : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
              {!result.rows.length && (
                <tr>
                  <td colSpan={result.columns.length || 1} className="px-3 py-8 text-center text-[var(--color-ink-faint)]" data-testid="script-report-empty">
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
