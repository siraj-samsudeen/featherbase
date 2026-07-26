import { useEffect, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { api, ApiError } from '../lib/api'

// WEB-002: a public, session-less form. Fetches its column config and creates
// a row on submit; server validation errors surface inline.

interface WebFormColumn {
  column_name: string
  label: string
  column_type: string
  reference_table: string | null
  reqd: boolean
}
interface WebFormConfig {
  route: string
  title: string
  columns: WebFormColumn[]
  success_message: string
}

function Column({
  def,
  value,
  onChange,
}: {
  def: WebFormColumn
  value: string
  onChange: (v: string) => void
}) {
  const testid = `wf-field-${def.column_name}`
  const common = { 'data-testid': testid, className: 'fc-input', value, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(e.target.value) }
  if (def.column_type === 'Long Text' || def.column_type === 'Text') return <textarea rows={4} {...common} />
  if (def.column_type === 'Choice')
    return (
      <select {...common}>
        <option value="">—</option>
      </select>
    )
  if (def.column_type === 'Check')
    return (
      <input
        type="checkbox"
        data-testid={testid}
        checked={value === '1'}
        onChange={(e) => onChange(e.target.checked ? '1' : '')}
      />
    )
  const type = def.column_type === 'Date' ? 'date' : ['Int', 'Float', 'Currency'].includes(def.column_type) ? 'number' : 'text'
  return <input type={type} {...common} />
}

export function WebFormPage() {
  const { route } = useParams({ from: '/form/$route' })
  const [config, setConfig] = useState<WebFormConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .get<WebFormConfig>(`/api/web_form/${encodeURIComponent(route)}`)
      .then(setConfig)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Form not found'))
  }, [route])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(values)) if (v !== '') payload[k] = v === '1' ? true : v
      const res = await api.post<{ message: string }>(`/api/web_form/${encodeURIComponent(route)}`, { values: payload })
      setDone(res.message)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submission failed')
    } finally {
      setBusy(false)
    }
  }

  if (loadError)
    return (
      <div className="mx-auto mt-16 max-w-lg px-4" data-testid="web-form-error">
        <div className="fc-card p-6 text-sm text-red-600">{loadError}</div>
      </div>
    )
  if (!config) return <div className="p-8 text-center text-[var(--color-ink-faint)]">Loading…</div>

  return (
    <div className="mx-auto mt-16 max-w-lg px-4" data-testid="web-form">
      <h1 className="mb-4 text-xl font-semibold text-[var(--color-ink)]" data-testid="web-form-title">
        {config.title}
      </h1>
      {done ? (
        <div className="fc-card p-6 text-sm text-green-700" data-testid="web-form-success">
          {done}
        </div>
      ) : (
        <form className="fc-card space-y-4 p-6" data-testid="web-form-form" onSubmit={submit}>
          {config.columns.map((c) => (
            <div key={c.column_name}>
              <label className="fc-label">
                {c.label}
                {c.reqd && <span className="text-red-500"> *</span>}
              </label>
              <Column def={c} value={values[c.column_name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [c.column_name]: v }))} />
            </div>
          ))}
          {error && (
            <p className="text-sm text-red-600" data-testid="web-form-submit-error">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className="fc-btn-primary w-full justify-center py-2" data-testid="web-form-submit">
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </form>
      )}
    </div>
  )
}
