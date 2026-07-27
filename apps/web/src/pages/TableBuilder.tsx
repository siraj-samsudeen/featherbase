import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { COLUMN_TYPES } from '../lib/meta'

interface ColumnRow {
  column_name: string
  label: string
  column_type: string
  // Entered comma-/newline-separated; split into reference_table/choices/row_table
  // on submit depending on column_type.
  target: string
  reqd: boolean
  in_list_view: boolean
}

const blank = (): ColumnRow => ({
  column_name: '',
  label: '',
  column_type: 'Data',
  target: '',
  reqd: false,
  in_list_view: false,
})

const TARGET_REQUIRED_TYPES = ['Choice', 'Reference', 'Sub-table']

// UI-011: build and edit Tables entirely from the Admin. Uses POST
// /api/doctype (create) and PUT /api/doctype/:name (schema sync).
export function TableBuilder() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [columns, setColumns] = useState<ColumnRow[]>([blank()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function setColumn(i: number, patch: Partial<ColumnRow>) {
    setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  }

  async function create() {
    setError(null)
    setSaving(true)
    try {
      const payload = {
        name,
        columns: columns
          .filter((c) => c.column_name.trim())
          .map((c) => {
            const target = c.target.trim()
              ? c.target
                  .split(/[\n,]/)
                  .map((o) => o.trim())
                  .filter(Boolean)
                  .join('\n')
              : undefined
            return {
              column_name: c.column_name.trim(),
              label: c.label.trim() || undefined,
              column_type: c.column_type,
              reference_table: c.column_type === 'Reference' ? target : undefined,
              choices: c.column_type === 'Choice' ? target : undefined,
              row_table: c.column_type === 'Sub-table' ? target : undefined,
              reqd: c.reqd,
              in_list_view: c.in_list_view,
            }
          }),
      }
      await api.post('/api/doctype', payload)
      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      navigate({ to: '/desk/$doctype', params: { doctype: name }, search: { filters: undefined } })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="doctype-builder" className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold text-[var(--color-ink)]">New Table</h1>
      <label className="fc-label">Table name</label>
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
              <th className="px-2 py-1">Column Name</th>
              <th className="px-2 py-1">Label</th>
              <th className="px-2 py-1">Column Type</th>
              <th className="px-2 py-1">Target</th>
              <th className="px-2 py-1">Reqd</th>
              <th className="px-2 py-1">List</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {columns.map((c, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-1 py-1">
                  <input
                    value={c.column_name}
                    onChange={(e) => setColumn(i, { column_name: e.target.value })}
                    data-rowfield="column_name"
                    className="w-full rounded border border-gray-200 px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    value={c.label}
                    onChange={(e) => setColumn(i, { label: e.target.value })}
                    data-rowfield="label"
                    className="w-full rounded border border-gray-200 px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-1">
                  <select
                    value={c.column_type}
                    onChange={(e) => setColumn(i, { column_type: e.target.value })}
                    data-rowfield="column_type"
                    className="rounded border border-gray-200 px-1 py-0.5"
                  >
                    {COLUMN_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-1">
                  <input
                    value={c.target}
                    onChange={(e) => setColumn(i, { target: e.target.value })}
                    data-rowfield="target"
                    placeholder={TARGET_REQUIRED_TYPES.includes(c.column_type) ? 'required' : ''}
                    className="w-full rounded border border-gray-200 px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={c.reqd}
                    onChange={(e) => setColumn(i, { reqd: e.target.checked })}
                    data-rowfield="reqd"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={c.in_list_view}
                    onChange={(e) => setColumn(i, { in_list_view: e.target.checked })}
                    data-rowfield="in_list_view"
                  />
                </td>
                <td className="px-1 text-center">
                  <button
                    aria-label="Remove column"
                    onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))}
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
          onClick={() => setColumns((cs) => [...cs, blank()])}
          data-testid="dt-add-field"
          className="w-full border-t border-gray-100 px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-50"
        >
          + Add column
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
        {saving ? 'Creating…' : 'Create Table'}
      </button>
    </div>
  )
}
