// PROTOTYPE — THROWAWAY. Variant B: type (or paste) the columns as a list —
// the way you'd write a spreadsheet header row — and the page builds the
// table from it. First line = column labels (comma-, tab- or newline-
// separated); any further lines are sample rows used to infer types, the
// same inference the CSV import already runs.
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { idPatternFor, inferColumnType, seriesPrefix } from 'shared'
import { ApiError, api } from '../../lib/api'
import { NamingControl } from '../../components/NamingControl'
import { COLUMN_TYPES } from '../../lib/meta'
import { ProtoColumn, blankCol, checkColumn, slugify, toPayload } from './proto-shared'

const DATA_TYPES = COLUMN_TYPES.filter((t) => !['Section Break', 'Column Break', 'Sub-table'].includes(t))

function splitLine(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : ','
  return line.split(sep).map((s) => s.trim()).filter(Boolean)
}

export function VariantB() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [module, setModule] = useState('Custom')
  const [namingOverride, setNamingOverride] = useState<string | null>(null)
  const [text, setText] = useState('')
  // Once parsed, the grid is the source of truth; the textarea becomes an
  // "add more" box. Re-parsing over user edits would destroy them.
  const [columns, setColumns] = useState<ProtoColumn[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const idPattern = namingOverride ?? (name.trim() ? idPatternFor(name) : '.###')

  // Live preview of what "Build columns" will produce.
  const preview = useMemo(() => {
    const lines = text.split('\n').filter((l) => l.trim())
    if (!lines.length) return []
    const headers = splitLine(lines[0])
    const samples = lines.slice(1).map(splitLine)
    return headers.map((h, i) => ({
      label: h,
      column_name: slugify(h),
      column_type: samples.length
        ? inferColumnType(samples.map((r) => r[i]).filter((v) => v !== undefined))
        : 'Data',
    }))
  }, [text])

  function build() {
    setColumns(
      preview.map((p, i) => ({
        ...blankCol(),
        label: p.label,
        column_name: p.column_name,
        column_type: p.column_type,
        in_list_view: i < 4, // first few columns make a useful list by default
        name_touched: true,
      })),
    )
    setText('')
  }

  const verdicts = useMemo(
    () => (columns ?? []).map((c) => checkColumn(c, columns ?? [])),
    [columns],
  )
  const hasBlockers = verdicts.some(Boolean)

  function patch(i: number, p: Partial<ProtoColumn>) {
    setColumns((cs) => (cs ?? []).map((c, j) => (j === i ? { ...c, ...p } : c)))
  }

  async function create() {
    setError(null)
    setSaving(true)
    try {
      await api.post('/api/doctype', toPayload(name, module, idPattern, columns ?? []))
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
      <h1 className="mb-1 text-xl font-semibold text-[var(--color-ink)]">New Table</h1>
      <p className="mb-4 text-sm text-gray-500">
        Type the columns the way you'd write a spreadsheet header row. Paste a row or two of data
        underneath and the types are worked out for you.
      </p>

      <div className="mb-4 flex flex-wrap gap-4">
        <div>
          <label className="fc-label">Table name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Employee" className="fc-input max-w-sm" />
        </div>
        <div>
          <label className="fc-label">Module</label>
          <input value={module} onChange={(e) => setModule(e.target.value)} placeholder="Custom" className="fc-input max-w-48" />
        </div>
      </div>

      {columns === null && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={'Employee Name, Date of Birth, Salary, Department\nRavi Kumar, 12/03/1990, 45000, Stores'}
            className="fc-input w-full font-mono text-sm"
            autoFocus
          />
          {preview.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {preview.map((p, i) => (
                <span key={i} className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-600">
                  {p.label} <span className="text-gray-400">· {p.column_type}</span>
                </span>
              ))}
            </div>
          )}
          <div>
            <button onClick={build} disabled={!preview.length} className="fc-btn fc-btn-primary mt-3">
              Build columns →
            </button>
          </div>
        </>
      )}

      {columns !== null && (
        <>
          <div className="fc-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-600">
                <tr>
                  <th className="px-2 py-1">Field label</th>
                  <th className="px-2 py-1">Database name</th>
                  <th className="px-2 py-1">Type</th>
                  <th className="px-2 py-1">Details</th>
                  <th className="px-2 py-1">List</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-gray-100 bg-blue-50/60">
                  <td className="px-2 py-1 text-gray-500">Row ID</td>
                  <td className="px-1 py-1" colSpan={4}>
                    <NamingControl
                      value={idPattern}
                      onChange={setNamingOverride}
                      defaultPrefix={seriesPrefix(name)}
                      columns={columns.map((c) => ({
                        column_name: c.column_name,
                        label: c.label || c.column_name,
                      }))}
                    />
                  </td>
                  <td className="px-1 text-center text-gray-300">🔒</td>
                </tr>
                {columns.map((c, i) => (
                  <tr key={i} className="border-t border-gray-100 align-top">
                    <td className="px-1 py-1">
                      <input value={c.label} onChange={(e) => patch(i, { label: e.target.value })} className="w-full rounded border border-gray-200 px-1 py-0.5" />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={c.column_name}
                        onChange={(e) => patch(i, { column_name: e.target.value })}
                        className={`w-full rounded border px-1 py-0.5 font-mono text-xs ${verdicts[i] ? 'border-[var(--color-danger)]' : 'border-gray-200'}`}
                      />
                      {verdicts[i] && <p className="mt-0.5 text-xs text-[var(--color-danger)]">{verdicts[i]!.error}</p>}
                    </td>
                    <td className="px-1 py-1">
                      <select value={c.column_type} onChange={(e) => patch(i, { column_type: e.target.value })} className="rounded border border-gray-200 px-1 py-0.5">
                        {DATA_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      {['Choice', 'Reference'].includes(c.column_type) ? (
                        <input
                          value={c.target}
                          onChange={(e) => patch(i, { target: e.target.value })}
                          placeholder={c.column_type === 'Choice' ? 'Small, Medium, Large' : 'Which table?'}
                          className="w-full rounded border border-gray-200 px-1 py-0.5"
                        />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input type="checkbox" checked={c.in_list_view} onChange={(e) => patch(i, { in_list_view: e.target.checked })} />
                    </td>
                    <td className="px-1 text-center">
                      <button aria-label="Remove column" onClick={() => setColumns((cs) => (cs ?? []).filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-600">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={() => setColumns((cs) => [...(cs ?? []), { ...blankCol(), name_touched: true }])}
              className="w-full border-t border-gray-100 px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-50"
            >
              + Add column
            </button>
          </div>
          <button onClick={() => setColumns(null)} className="mt-2 text-xs text-gray-500 underline">
            ← Start over from a list
          </button>
        </>
      )}

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div>
        <button
          onClick={create}
          disabled={saving || !name.trim() || columns === null || hasBlockers}
          className="fc-btn fc-btn-primary mt-4"
        >
          Create Table
        </button>
      </div>
    </div>
  )
}
