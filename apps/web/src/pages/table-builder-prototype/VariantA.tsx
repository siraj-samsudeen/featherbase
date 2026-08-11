// PROTOTYPE — THROWAWAY. Variant A: the existing grid, re-ordered around the
// human. Field label comes FIRST and the database name is derived from it
// live (until hand-edited), validation runs on blur with a one-click fix,
// and layout types are out of the type list.
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { idPatternFor, seriesPrefix } from 'shared'
import { ApiError, api } from '../../lib/api'
import { NamingControl } from '../../components/NamingControl'
import { COLUMN_TYPES } from '../../lib/meta'
import {
  ProtoColumn,
  TARGET_REQUIRED,
  blankCol,
  checkColumn,
  slugify,
  toPayload,
} from './proto-shared'

// Data-bearing types only; Section/Column Break are layout, not data, and
// don't belong in the same decision (idea #6 from the review).
const DATA_TYPES = COLUMN_TYPES.filter((t) => !['Section Break', 'Column Break'].includes(t))

export function VariantA() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [module, setModule] = useState('Custom')
  const [namingOverride, setNamingOverride] = useState<string | null>(null)
  const [columns, setColumns] = useState<ProtoColumn[]>([blankCol()])
  // Which rows have been blurred — only those show their verdicts, so the
  // user is never scolded mid-word.
  const [touched, setTouched] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const idPattern = namingOverride ?? (name.trim() ? idPatternFor(name) : '.###')

  const verdicts = useMemo(
    () => columns.map((c) => checkColumn(c, columns)),
    [columns],
  )
  const hasBlockers = verdicts.some((v, i) => v && columns[i].column_name.trim())

  function patch(i: number, p: Partial<ProtoColumn>) {
    setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)))
  }

  function onLabel(i: number, label: string) {
    const c = columns[i]
    // The identifier follows the label until the user claims it (#151 ask 1).
    patch(i, { label, ...(c.name_touched ? {} : { column_name: slugify(label) }) })
  }

  async function create() {
    setError(null)
    setSaving(true)
    try {
      await api.post('/api/doctype', toPayload(name, module, idPattern, columns))
      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      await queryClient.invalidateQueries({ queryKey: ['home-pages'] })
      navigate({ to: '/admin/$doctype', params: { doctype: name }, search: { filters: undefined } })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold text-[var(--color-ink)]">New Table</h1>

      <div className="mb-4 flex flex-wrap gap-4">
        <div>
          <label className="fc-label">Table name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Project" className="fc-input max-w-sm" />
        </div>
        <div>
          <label className="fc-label">Module</label>
          <input value={module} onChange={(e) => setModule(e.target.value)} placeholder="Custom" className="fc-input max-w-48" />
        </div>
      </div>

      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              <th className="px-2 py-1">Field label</th>
              <th className="px-2 py-1">
                Database name{' '}
                <span className="font-normal text-gray-400" title="Derived from the label; click the pencil to set it yourself">
                  (auto)
                </span>
              </th>
              <th className="px-2 py-1">Type</th>
              <th className="px-2 py-1">Details</th>
              <th className="px-2 py-1" title="Must be filled in every row">Required</th>
              <th className="px-2 py-1" title="Shown in the list view">List</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-100 bg-blue-50/60">
              <td className="px-2 py-1 align-baseline text-gray-500">Row ID</td>
              <td className="px-1 py-1" colSpan={5}>
                <NamingControl
                  value={idPattern}
                  onChange={setNamingOverride}
                  defaultPrefix={seriesPrefix(name)}
                  columns={columns
                    .filter((c) => c.column_name.trim())
                    .map((c) => ({ column_name: c.column_name.trim(), label: c.label.trim() || c.column_name.trim() }))}
                />
              </td>
              <td className="px-1 text-center text-gray-300" title="always present">🔒</td>
            </tr>
            {columns.map((c, i) => {
              const verdict = touched.has(i) ? verdicts[i] : null
              return (
                <tr key={i} className="border-t border-gray-100 align-top">
                  <td className="px-1 py-1">
                    <input
                      value={c.label}
                      onChange={(e) => onLabel(i, e.target.value)}
                      onBlur={() => setTouched((t) => new Set(t).add(i))}
                      placeholder="e.g. Date of Birth"
                      autoFocus={i === columns.length - 1 && columns.length > 1}
                      className="w-full rounded border border-gray-200 px-1 py-0.5"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-1">
                      <input
                        value={c.column_name}
                        onChange={(e) => patch(i, { column_name: e.target.value, name_touched: true })}
                        onBlur={() => setTouched((t) => new Set(t).add(i))}
                        readOnly={!c.name_touched}
                        aria-invalid={verdict ? true : undefined}
                        className={`w-full rounded border px-1 py-0.5 font-mono text-xs ${
                          verdict ? 'border-[var(--color-danger)]' : 'border-gray-200'
                        } ${c.name_touched ? '' : 'bg-gray-50 text-gray-500'}`}
                      />
                      {!c.name_touched && (
                        <button
                          title="Set the database name yourself"
                          onClick={() => patch(i, { name_touched: true })}
                          className="text-gray-300 hover:text-gray-600"
                        >
                          ✎
                        </button>
                      )}
                    </div>
                    {verdict && (
                      <p className="mt-0.5 text-xs text-[var(--color-danger)]">
                        {verdict.error}
                        {verdict.fix && (
                          <>
                            {' '}
                            <button
                              onClick={() => patch(i, { column_name: verdict.fix!, name_touched: true })}
                              className="font-medium underline"
                            >
                              Use “{verdict.fix}”
                            </button>
                          </>
                        )}
                      </p>
                    )}
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={c.column_type}
                      onChange={(e) => patch(i, { column_type: e.target.value })}
                      className="rounded border border-gray-200 px-1 py-0.5"
                    >
                      {DATA_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    {TARGET_REQUIRED.includes(c.column_type) ? (
                      <input
                        value={c.target}
                        onChange={(e) => patch(i, { target: e.target.value })}
                        onBlur={() => setTouched((t) => new Set(t).add(i))}
                        placeholder={
                          c.column_type === 'Choice'
                            ? 'Choices: Small, Medium, Large'
                            : c.column_type === 'Reference'
                              ? 'Which table?'
                              : 'Which sub-table?'
                        }
                        className="w-full rounded border border-gray-200 px-1 py-0.5"
                      />
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-1 py-1 text-center">
                    <input type="checkbox" checked={c.reqd} onChange={(e) => patch(i, { reqd: e.target.checked })} />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <input type="checkbox" checked={c.in_list_view} onChange={(e) => patch(i, { in_list_view: e.target.checked })} />
                  </td>
                  <td className="px-1 text-center">
                    <button
                      aria-label="Remove column"
                      onClick={() => {
                        setColumns((cs) => cs.filter((_, j) => j !== i))
                        setTouched(new Set())
                      }}
                      className="text-gray-300 hover:text-red-600"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <button
          onClick={() => setColumns((cs) => [...cs, blankCol()])}
          className="w-full border-t border-gray-100 px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-50"
        >
          + Add column
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <button
        onClick={create}
        disabled={saving || !name.trim() || hasBlockers}
        title={hasBlockers ? 'Fix the flagged columns first' : undefined}
        className="fc-btn fc-btn-primary mt-4"
      >
        Create Table
      </button>
    </div>
  )
}
