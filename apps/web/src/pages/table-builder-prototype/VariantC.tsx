// PROTOTYPE — THROWAWAY. Variant C: no table metaphor at all. Each column is
// a card: a labelled name input, the type as friendly chips, and the
// type-specific detail control appears inside the card properly labelled.
// The database identifier is a quiet "stored as" footnote, not a demand.
// Restyled 2026-08-11 to the fc-* tokens (PROGRESS.md "Visual identity"):
// CSS variables only, so it holds up across all four palettes and dark mode.
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

  const verdicts = useMemo(() => columns.map((c) => checkColumn(c, columns, name)), [columns, name])
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

      <div className="space-y-3">
        <div className="fc-card p-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            Table
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="grow">
              <label className="fc-label">Table name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Employee" className="fc-input" />
            </div>
            <div>
              <label className="fc-label">Module</label>
              <input value={module} onChange={(e) => setModule(e.target.value)} placeholder="Custom" className="fc-input max-w-40" />
            </div>
          </div>
        </div>

        <div className="fc-card p-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            Row ID
          </div>
          <NamingControl
            value={idPattern}
            onChange={setNamingOverride}
            defaultPrefix={seriesPrefix(name)}
            columns={columns
              .filter((c) => c.column_name.trim())
              .map((c) => ({ column_name: c.column_name.trim(), label: c.label.trim() || c.column_name.trim() }))}
          />
        </div>

        {columns.map((c, i) => {
          const verdict = verdicts[i]
          return (
            <div key={i} className="fc-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                  Column {i + 1}
                </span>
                {columns.length > 1 && (
                  <button
                    aria-label="Remove column"
                    onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))}
                    className="rounded px-1.5 text-sm text-[var(--color-ink-faint)] transition hover:bg-[var(--color-subtle)] hover:text-[var(--color-danger)]"
                  >
                    ✕
                  </button>
                )}
              </div>

              <input
                value={c.label}
                onChange={(e) =>
                  patch(i, {
                    label: e.target.value,
                    ...(c.name_touched ? {} : { column_name: slugify(e.target.value) }),
                  })
                }
                placeholder="e.g. Date of Birth"
                autoFocus={i === columns.length - 1}
                className="fc-input mb-4 text-base font-medium"
              />

              <label className="fc-label">Type</label>
              <div className="mb-1 flex flex-wrap gap-1.5">
                {FRIENDLY.map((f) => (
                  <button
                    key={f.type}
                    title={f.hint}
                    onClick={() => patch(i, { column_type: f.type, target: '' })}
                    className={`fc-pill border px-3 py-1 transition ${
                      c.column_type === f.type
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
                        : 'border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {c.column_type === 'Choice' && (
                <div className="mt-3">
                  <label className="fc-label">The options, comma-separated</label>
                  <input
                    value={c.target}
                    onChange={(e) => patch(i, { target: e.target.value })}
                    placeholder="Small, Medium, Large"
                    className="fc-input"
                  />
                </div>
              )}
              {c.column_type === 'Reference' && (
                <div className="mt-3">
                  <label className="fc-label">Which table does it link to?</label>
                  <select value={c.target} onChange={(e) => patch(i, { target: e.target.value })} className="fc-input">
                    <option value="">Choose a table…</option>
                    {(tables?.data ?? []).map((t) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-ink-muted)]">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={c.reqd}
                    onChange={(e) => patch(i, { reqd: e.target.checked })}
                    className="accent-[var(--color-brand)]"
                  />
                  Required
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={c.in_list_view}
                    onChange={(e) => patch(i, { in_list_view: e.target.checked })}
                    className="accent-[var(--color-brand)]"
                  />
                  Show in the list
                </label>
                {c.column_name.trim() && !verdict && (
                  <span
                    className="ml-auto font-mono text-xs text-[var(--color-ink-faint)]"
                    title="How it's stored in the database — derived from the label"
                  >
                    stored as {c.column_name}
                  </span>
                )}
              </div>

              {verdict && c.column_name.trim() && (
                <p className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-danger-tint)] px-3 py-2 text-xs text-[var(--color-danger)]">
                  {verdict.error}
                  {verdict.fix && (
                    <>
                      {' '}
                      <button
                        onClick={() => patch(i, { column_name: verdict.fix!, name_touched: true })}
                        className="font-semibold underline"
                      >
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

      <div className="mt-4 flex items-center gap-3">
        <button onClick={() => setColumns((cs) => [...cs, blankCol()])} className="fc-btn">
          + Add a column
        </button>
        <button
          onClick={create}
          disabled={saving || !name.trim() || hasBlockers}
          title={hasBlockers ? 'Fix the flagged columns first' : undefined}
          className="fc-btn-primary"
        >
          Create Table
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}
    </div>
  )
}
