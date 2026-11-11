import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { choiceLabel } from 'shared'
import { api, ApiError } from '../lib/api'
import { buttonClasses, cardClasses, inputClasses, labelClasses } from '@featherbase/shop-floor'
import { useI18n } from '../lib/i18n'

// RPT-005: renders a server-side Code Report — its declared filter controls
// and the columns+rows its execute() returns.

interface FilterDef {
  column_name: string
  label: string
  column_type: string
  choices?: string
  choice_labels?: Record<string, string> | null
  default?: unknown
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
  value: unknown
  onChange: (v: string) => void
}) {
  const { t } = useI18n()
  const testid = `sr-filter-${def.column_name}`
  if (def.column_type === 'Choice') {
    const opts = (def.choices ?? '').split('\n')
    return (
      <select className={inputClasses()} data-testid={testid} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o ? choiceLabel(o, def.choice_labels, t) : '(any)'}
          </option>
        ))}
      </select>
    )
  }
  if (def.column_type === 'Check')
    return (
      <label className="cursor-pointer">
        <input
          type="checkbox"
          data-testid={testid}
          checked={value === true || value === 1 || value === '1'}
          onChange={(e) => onChange(e.target.checked ? '1' : '')}
        />
      </label>
    )
  const type = def.column_type === 'Date' ? 'date' : def.column_type === 'Int' ? 'number' : 'text'
  return (
    <input
      className={inputClasses()}
      type={type}
      data-testid={testid}
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function ScriptReportView({ name }: { name: string }) {
  const meta = useQuery({
    queryKey: ['script-report', name],
    queryFn: () => api.get<ScriptReportMeta>(`/api/script_report/${encodeURIComponent(name)}`),
  })
  if (meta.isError)
    return (
      <div className={cardClasses('p-4 text-sm text-negative')} data-testid="script-report-error">
        {meta.error instanceof ApiError ? meta.error.message : 'Report not found'}
      </div>
    )
  if (!meta.data) return <div className="p-4 text-ink-subtle">Loading…</div>
  return <ScriptReportForm key={name} meta={meta.data} />
}

function ScriptReportForm({ meta }: { meta: ScriptReportMeta }) {
  // Every filter starts with a value (its default, else '') and changes only
  // to the text its control gives, so none is ever null or missing.
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(meta.filters.map((f) => [f.column_name, f.default ?? ''])),
  )
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const filters: Record<string, unknown> = {}
      for (const f of meta.filters) {
        const v = values[f.column_name]
        if (v !== '' && v != null)
          filters[f.column_name] = f.column_type === 'Check' ? v === true || v === 1 || v === '1' : v
      }
      setResult(await api.post<RunResult>('/api/run_script_report', { report: meta.name, filters }))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to run report')
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div data-testid="script-report" className="space-y-4">
      <h1 className="text-lg font-semibold text-ink" data-testid="script-report-title">
        {meta.name}
      </h1>

      {meta.filters.length > 0 && (
        <div className={cardClasses('flex flex-wrap items-end gap-3 p-3')} data-testid="script-report-filters">
          {meta.filters.map((f) => (
            <div key={f.column_name}>
              <label className={labelClasses()}>{f.label}</label>
              <FilterControl
                def={f}
                value={values[f.column_name]}
                onChange={(v) => setValues((s) => ({ ...s, [f.column_name]: v }))}
              />
            </div>
          ))}
          <button className={buttonClasses({ variant: 'primary' })} data-testid="script-report-run" onClick={() => void run()}>
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      )}

      {error && (
        <div className={cardClasses('p-3 text-sm text-negative')} data-testid="script-report-run-error">
          {error}
        </div>
      )}

      {result && (
        <div className={cardClasses('overflow-x-auto')}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-ink-muted">
                {result.columns.map((col) => (
                  <th key={col} className="px-3 py-2 font-medium" data-testid={`sr-col-${col}`}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody data-testid="script-report-rows">
              {result.rows.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {result.columns.map((col) => (
                    <td key={col} className="px-3 py-2 text-ink">
                      {row[col] == null ? '—' : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
              {!result.rows.length && (
                <tr>
                  <td colSpan={result.columns.length || 1} className="px-3 py-8 text-center text-ink-subtle" data-testid="script-report-empty">
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
