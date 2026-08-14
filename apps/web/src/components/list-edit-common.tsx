// Shared machinery for the Grid and Datasheet list views (list editing,
// owner-ratified 2026-08-14). Every save here is a per-row autosave through
// the normal row lifecycle — GET for the fresh revision, PATCH with only the
// changed fields — never a side-channel write.
import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api'
import type { ColumnDef, TableMeta } from '../lib/meta'
import { formatValue, type Settings } from '../lib/settings'

export type Row = Record<string, unknown>
export type Col = { column_name: string; label: string; column_type: string }

export function cellText(value: unknown, columnType: string, settings: Settings): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  return formatValue(columnType, value, settings) || '—'
}

export function choiceOptions(meta: TableMeta, col: string): string[] {
  const def = meta.columns.find((c) => c.column_name === col)
  return (def?.choices ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Which of the visible columns can be edited in place. Complex types keep
// the form as their editing surface (same exclusions as bulk edit).
const UNEDITABLE_TYPES = new Set(['Sub-table', 'Attach', 'Attach Image', 'JSON'])
export function editableInline(meta: TableMeta, col: Col): boolean {
  if (col.column_name === 'name') return false
  const def = meta.columns.find((c) => c.column_name === col.column_name)
  return Boolean(def && !def.read_only && !UNEDITABLE_TYPES.has(def.column_type))
}

export function editableColumnDefs(meta: TableMeta, columns: Col[]): ColumnDef[] {
  return meta.columns.filter((d) =>
    columns.some((c) => c.column_name === d.column_name && editableInline(meta, c)),
  )
}

export type RowSaveState = { state: 'saving' | 'saved' | 'error'; message?: string }

// Per-row autosave: GET the fresh doc (revision), PATCH the changed fields.
// Status drives the row gutter: ⋯ saving, ✓ saved (fades), ● error (sticky
// until the next save attempt succeeds).
export function useRowSave(doctype: string, onSaved: () => void | Promise<void>) {
  const [status, setStatus] = useState<Record<string, RowSaveState>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  async function save(rowName: string, fields: Row): Promise<boolean> {
    if (!Object.keys(fields).length) return true
    clearTimeout(timers.current[rowName])
    setStatus((s) => ({ ...s, [rowName]: { state: 'saving' } }))
    try {
      const doc = await api.get<Row>(
        `/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(rowName)}`,
      )
      await api.patch(`/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(rowName)}`, {
        ...fields,
        updated_at: doc.updated_at,
      })
      setStatus((s) => ({ ...s, [rowName]: { state: 'saved' } }))
      timers.current[rowName] = setTimeout(() => {
        setStatus(({ [rowName]: _, ...rest }) => rest)
      }, 1500)
      await onSaved()
      return true
    } catch (err) {
      const message =
        err instanceof ApiError
          ? [err.message, ...(err.fields ? Object.values(err.fields) : [])].join(' — ')
          : 'Save failed'
      setStatus((s) => ({ ...s, [rowName]: { state: 'error', message } }))
      return false
    }
  }

  return { status, save }
}

export function RowStatusDot({ status, dirty }: { status?: RowSaveState; dirty?: boolean }) {
  if (status?.state === 'saving')
    return (
      <span className="text-xs text-[var(--color-ink-faint)]" title="Saving…" data-testid="row-saving">
        ⋯
      </span>
    )
  if (status?.state === 'saved')
    return (
      <span className="text-xs text-[var(--color-success,#16a34a)]" title="Saved" data-testid="row-saved">
        ✓
      </span>
    )
  if (status?.state === 'error')
    return (
      <span
        className="cursor-help text-xs text-[var(--color-danger)]"
        title={status.message}
        data-testid="row-save-error"
      >
        ●
      </span>
    )
  if (dirty)
    return (
      <span className="text-xs text-[var(--color-warning,#ea580c)]" title="Unsaved" data-testid="row-dirty">
        ●
      </span>
    )
  return null
}
