import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { seriesPrefix } from 'shared'
import { ApiError, api } from '../lib/api'
import { NO_COLUMN_TYPES, useMeta } from '../lib/meta'
import { NamingControl } from './NamingControl'

// NAM-001: change how an existing Table names new rows. Rows already saved keep
// the names they were given — a series only ever applies from here forward.
export function TableNaming({ table }: { table: string }) {
  const meta = useMeta(table)
  const queryClient = useQueryClient()
  const [pattern, setPattern] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (meta.data) setPattern(meta.data.id_pattern)
  }, [meta.data])

  async function save() {
    if (pattern === null) return
    setSaving(true)
    setError(null)
    try {
      await api.put(`/api/table_def/${encodeURIComponent(table)}/id_pattern`, {
        id_pattern: pattern,
      })
      await queryClient.invalidateQueries({ queryKey: ['meta', table] })
      setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (meta.isError)
    return (
      <div className="fc-card p-4 text-sm text-red-600" data-testid="naming-error">
        {meta.error instanceof ApiError ? meta.error.message : 'Cannot load this Table'}
      </div>
    )
  if (!meta.data || pattern === null)
    return <div className="p-4 text-[var(--color-ink-faint)]">Loading…</div>

  const dirty = pattern !== meta.data.id_pattern

  return (
    <div data-testid="table-naming" className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-ink)]">Naming — {table}</h1>
        <div className="flex items-center gap-3">
          {saved && !dirty && (
            <span className="text-sm text-green-700" data-testid="naming-saved">
              Saved
            </span>
          )}
          <button
            className="fc-btn fc-btn-primary"
            data-testid="naming-save"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="fc-card p-3 text-sm text-red-600" data-testid="naming-save-error">
          {error}
        </div>
      )}

      <div className="fc-card p-4">
        <label className="fc-label">How new rows are named</label>
        <NamingControl
          value={pattern}
          onChange={(p) => {
            setPattern(p)
            setSaved(false)
          }}
          defaultPrefix={seriesPrefix(table)}
          idPrefix="naming"
          columns={meta.data.columns
            .filter((c) => !NO_COLUMN_TYPES.has(c.column_type))
            .map((c) => ({ column_name: c.column_name, label: c.label ?? c.column_name }))}
        />
        <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
          Rows that already exist keep their current names; this applies to rows created from
          now on.
        </p>
      </div>
    </div>
  )
}
