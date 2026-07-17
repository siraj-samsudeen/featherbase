import { useEffect, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { api, ApiError } from '../lib/api'

// WEB-002: a public, session-less form. Fetches its field config and creates a
// document on submit; server validation errors surface inline.

interface WebFormField {
  fieldname: string
  label: string
  fieldtype: string
  options: string | null
  reqd: boolean
}
interface WebFormConfig {
  route: string
  title: string
  fields: WebFormField[]
  success_message: string
}

function Field({
  def,
  value,
  onChange,
}: {
  def: WebFormField
  value: string
  onChange: (v: string) => void
}) {
  const testid = `wf-field-${def.fieldname}`
  const common = { 'data-testid': testid, className: 'fc-input', value, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(e.target.value) }
  if (def.fieldtype === 'Long Text' || def.fieldtype === 'Text') return <textarea rows={4} {...common} />
  if (def.fieldtype === 'Select')
    return (
      <select {...common}>
        {(def.options ?? '').split('\n').map((o) => (
          <option key={o} value={o}>
            {o || '—'}
          </option>
        ))}
      </select>
    )
  if (def.fieldtype === 'Check')
    return (
      <input
        type="checkbox"
        data-testid={testid}
        checked={value === '1'}
        onChange={(e) => onChange(e.target.checked ? '1' : '')}
      />
    )
  const type = def.fieldtype === 'Date' ? 'date' : ['Int', 'Float', 'Currency'].includes(def.fieldtype) ? 'number' : 'text'
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
          {config.fields.map((f) => (
            <div key={f.fieldname}>
              <label className="fc-label">
                {f.label}
                {f.reqd && <span className="text-red-500"> *</span>}
              </label>
              <Field def={f} value={values[f.fieldname] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.fieldname]: v }))} />
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
