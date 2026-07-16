import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { FIELD_TYPES } from '../lib/meta'

interface FieldRow {
  fieldname: string
  label: string
  fieldtype: string
  options: string
  reqd: boolean
  in_list_view: boolean
}

const blank = (): FieldRow => ({
  fieldname: '',
  label: '',
  fieldtype: 'Data',
  options: '',
  reqd: false,
  in_list_view: false,
})

// UI-011: build and edit DocTypes entirely from the Desk. Uses POST
// /api/doctype (create) and PUT /api/doctype/:name (schema sync).
export function DocTypeBuilder() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [fields, setFields] = useState<FieldRow[]>([blank()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function setField(i: number, patch: Partial<FieldRow>) {
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  }

  async function create() {
    setError(null)
    setSaving(true)
    try {
      const payload = {
        name,
        fields: fields
          .filter((f) => f.fieldname.trim())
          .map((f) => ({
            fieldname: f.fieldname.trim(),
            label: f.label.trim() || undefined,
            fieldtype: f.fieldtype,
            // Options entered comma- or newline-separated; Select/Link/Table
            // expect newline-separated, so normalize.
            options:
              f.options.trim()
                ? f.options
                    .split(/[\n,]/)
                    .map((o) => o.trim())
                    .filter(Boolean)
                    .join('\n')
                : undefined,
            reqd: f.reqd,
            in_list_view: f.in_list_view,
          })),
      }
      await api.post('/api/doctype', payload)
      await queryClient.invalidateQueries({ queryKey: ['doctypes'] })
      navigate({ to: '/desk/$doctype', params: { doctype: name }, search: { filters: undefined } })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="doctype-builder" className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold text-[var(--color-ink)]">New DocType</h1>
      <label className="fc-label">DocType name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid="dt-name"
        placeholder="e.g. Project"
        className="fc-input mb-4 max-w-sm"
      />

      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm" data-testid="dt-fields">
          <thead className="bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              <th className="px-2 py-1">Fieldname</th>
              <th className="px-2 py-1">Label</th>
              <th className="px-2 py-1">Type</th>
              <th className="px-2 py-1">Options</th>
              <th className="px-2 py-1">Reqd</th>
              <th className="px-2 py-1">List</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-1 py-1">
                  <input
                    value={f.fieldname}
                    onChange={(e) => setField(i, { fieldname: e.target.value })}
                    data-rowfield="fieldname"
                    className="w-full rounded border border-gray-200 px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    value={f.label}
                    onChange={(e) => setField(i, { label: e.target.value })}
                    data-rowfield="label"
                    className="w-full rounded border border-gray-200 px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-1">
                  <select
                    value={f.fieldtype}
                    onChange={(e) => setField(i, { fieldtype: e.target.value })}
                    data-rowfield="fieldtype"
                    className="rounded border border-gray-200 px-1 py-0.5"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-1">
                  <input
                    value={f.options}
                    onChange={(e) => setField(i, { options: e.target.value })}
                    data-rowfield="options"
                    placeholder={['Select', 'Link', 'Table'].includes(f.fieldtype) ? 'required' : ''}
                    className="w-full rounded border border-gray-200 px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={f.reqd}
                    onChange={(e) => setField(i, { reqd: e.target.checked })}
                    data-rowfield="reqd"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={f.in_list_view}
                    onChange={(e) => setField(i, { in_list_view: e.target.checked })}
                    data-rowfield="in_list_view"
                  />
                </td>
                <td className="px-1 text-center">
                  <button
                    aria-label="Remove field"
                    onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}
                    className="text-gray-300 hover:text-red-600"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => setFields((fs) => [...fs, blank()])}
          data-testid="dt-add-field"
          className="w-full border-t border-gray-100 px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-50"
        >
          + Add field
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600" data-testid="dt-error">
          {error}
        </p>
      )}
      <button
        onClick={create}
        disabled={saving || !name.trim()}
        data-testid="dt-create"
        className="fc-btn-primary mt-4 disabled:opacity-40"
      >
        {saving ? 'Creating…' : 'Create DocType'}
      </button>
    </div>
  )
}
