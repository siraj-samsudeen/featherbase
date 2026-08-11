// PROTOTYPE — THROWAWAY. Variant C: no table metaphor at all. Each column is
// a card: one big label input, the type as friendly labelled chips, and the
// type-specific detail control appears inside the card properly labelled.
// The database name is a small derived footnote, not a demand. Reference
// targets come from a real dropdown of existing tables. Layout types
// (Section/Column Break) are deliberately absent from this variant.
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { idPatternFor, seriesPrefix } from 'shared'
import { ApiError, api, listResource } from '../../lib/api'
import { NamingControl } from '../../components/NamingControl'
import { ProtoColumn, blankCol, checkColumn, slugify, toPayload } from './proto-shared'

// The engine's types behind words a spreadsheet user already has.
const FRIENDLY: { type: string; label: string; hint?: string }[] = [
  { type: 'Data', label: 'Text' },
  { type: 'Text', label: 'Long text' },
  { type: 'Int', label: 'Number' },
  { type: 'Float', label: 'Decimal' },
  { type: 'Currency', label: 'Money' },
  { type: 'Date', label: 'Date' },
  { type: 'Datetime', label: 'Date & time' },
  { type: 'Check', label: 'Yes / No' },
  { type: 'Choice', label: 'Pick from a list', hint: 'You define the options' },
  { type: 'Reference', label: 'Link to another table', hint: 'Points at a row elsewhere' },
  { type: 'Attach', label: 'File' },
  { type: 'JSON', label: 'JSON' },
]

export function VariantC() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [module, setModule] = useState('Custom')
  const [namingOverride, setNamingOverride] = useState<string | null>(null)
  const [columns, setColumns] = useState<ProtoColumn[]>([blankCol()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const idPattern = namingOverride ?? (name.trim() ? idPatternFor(name) : '.###')

  const { data: tables } = useQuery({
    queryKey: ['tables'],
    queryFn: () =>
      listResource<{ name: string }>('Table', {
        filters: [['kind', '!=', 'sub_table']],
        fields: ['name'],
        limit_page_length: 500,
      }),
  })

  const verdicts = useMemo(() => columns.map((c) => checkColumn(c, columns)), [columns])
  const hasBlockers = verdicts.some((v, i) => v && columns[i].column_name.trim())

  function patch(i: number, p: Partial<ProtoColumn>) {
    setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)))
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
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold text-[var(--color-ink)]">New Table</h1>

      <div className="fc-card mb-4 p-4">
        <div className="mb-3 flex flex-wrap gap-4">
          <div className="grow">
            <label className="fc-label">Table name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Employee" className="fc-input w-full" />
          </div>
          <div>
            <label className="fc-label">Module</label>
            <input value={module} onChange={(e) => setModule(e.target.value)} placeholder="Custom" className="fc-input max-w-40" />
          </div>
        </div>
        <label className="fc-label">How should rows be numbered?</label>
        <NamingControl
          value={idPattern}
          onChange={setNamingOverride}
          defaultPrefix={seriesPrefix(name)}
          columns={columns
            .filter((c) => c.column_name.trim())
            .map((c) => ({ column_name: c.column_name.trim(), label: c.label.trim() || c.column_name.trim() }))}
        />
      </div>

      <div className="space-y-3">
        {columns.map((c, i) => {
          const verdict = verdicts[i]
          return (
            <div key={i} className="fc-card p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <input
                  value={c.label}
                  onChange={(e) =>
                    patch(i, {
                      label: e.target.value,
                      ...(c.name_touched ? {} : { column_name: slugify(e.target.value) }),
                    })
                  }
                  placeholder="What is this column called? e.g. Date of Birth"
                  autoFocus={i === columns.length - 1}
                  className="w-full border-0 border-b border-gray-200 pb-1 text-base font-medium outline-none focus:border-[var(--color-brand)]"
                />
                <button
                  aria-label="Remove column"
                  onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))}
                  className="text-gray-300 hover:text-red-600"
                >
                  ×
                </button>
              </div>

              <div className="mb-3 flex flex-wrap gap-1.5">
                {FRIENDLY.map((f) => (
                  <button
                    key={f.type}
                    title={f.hint}
                    onClick={() => patch(i, { column_type: f.type, target: '' })}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      c.column_type === f.type
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                        : 'border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {c.column_type === 'Choice' && (
                <div className="mb-3">
                  <label className="fc-label">The options, comma-separated</label>
                  <input
                    value={c.target}
                    onChange={(e) => patch(i, { target: e.target.value })}
                    placeholder="Small, Medium, Large"
                    className="fc-input w-full"
                  />
                </div>
              )}
              {c.column_type === 'Reference' && (
                <div className="mb-3">
                  <label className="fc-label">Which table does it link to?</label>
                  <select value={c.target} onChange={(e) => patch(i, { target: e.target.value })} className="fc-input w-full">
                    <option value="">Choose a table…</option>
                    {(tables?.data ?? []).map((t) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={c.reqd} onChange={(e) => patch(i, { reqd: e.target.checked })} />
                  Must be filled in
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={c.in_list_view} onChange={(e) => patch(i, { in_list_view: e.target.checked })} />
                  Show in the list
                </label>
                {c.column_name.trim() && (
                  <span className="ml-auto font-mono text-xs text-gray-400" title="The name in the database — derived from the label">
                    {c.column_name}
                  </span>
                )}
              </div>

              {verdict && c.column_name.trim() && (
                <p className="mt-2 text-xs text-[var(--color-danger)]">
                  {verdict.error}
                  {verdict.fix && (
                    <>
                      {' '}
                      <button onClick={() => patch(i, { column_name: verdict.fix!, name_touched: true })} className="font-medium underline">
                        Use “{verdict.fix}”
                      </button>
                    </>
                  )}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <button onClick={() => setColumns((cs) => [...cs, blankCol()])} className="fc-btn mt-3">
        + Add a column
      </button>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div>
        <button
          onClick={create}
          disabled={saving || !name.trim() || hasBlockers}
          title={hasBlockers ? 'Fix the flagged columns first' : undefined}
          className="fc-btn fc-btn-primary mt-4"
        >
          Create Table
        </button>
      </div>
    </div>
  )
}
