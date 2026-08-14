// List editing, Datasheet mode (owner-ratified 2026-08-14, prototype
// variant C): every cell is always an input, Access-style. A row autosaves
// when focus leaves it (changed fields only, normal row lifecycle), and the
// ghost line at the bottom creates a new row through the ordinary row POST —
// so id patterns and automation triggers all run.
import { useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api'
import type { TableMeta } from '../lib/meta'
import type { Settings } from '../lib/settings'
import { changedFields } from '../lib/list-edit'
import {
  RowStatusDot,
  cellText,
  choiceOptions,
  editableColumnDefs,
  editableInline,
  useRowSave,
  type Col,
  type Row,
} from './list-edit-common'

export function DatasheetView({
  doctype,
  meta,
  rows: serverRows,
  columns,
  settings,
  onSaved,
}: {
  doctype: string
  meta: TableMeta
  rows: Row[]
  columns: Col[]
  settings: Settings
  onSaved: () => void | Promise<void>
}) {
  const [rows, setRows] = useState<Row[]>(serverRows)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [ghost, setGhost] = useState<Row | null>(null)
  const [ghostBusy, setGhostBusy] = useState(false)
  const [ghostError, setGhostError] = useState<string | null>(null)
  const { status, save } = useRowSave(doctype, onSaved)

  useEffect(() => {
    if (!dirty.size) setRows(serverRows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRows])

  function edit(r: number, key: string, value: unknown) {
    setRows((rs) => rs.map((row, i) => (i === r ? { ...row, [key]: value } : row)))
    setDirty((d) => new Set(d).add(String(rows[r].name)))
  }

  function saveRow(name: string) {
    if (!dirty.has(name)) return
    setDirty((d) => {
      const next = new Set(d)
      next.delete(name)
      return next
    })
    const row = rows.find((x) => String(x.name) === name)
    const original = serverRows.find((s) => String(s.name) === name)
    if (!row || !original) return
    void save(name, changedFields(original, row, editableColumnDefs(meta, columns))).then((ok) => {
      if (!ok)
        setDirty((d) => {
          const next = new Set(d)
          next.add(name)
          return next
        })
    })
  }

  // focusout bubbles from the <tr>; when focus lands outside it, autosave.
  function rowBlur(name: string) {
    return (e: React.FocusEvent<HTMLTableRowElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return
      saveRow(name)
    }
  }

  async function commitGhost() {
    if (!ghost || ghostBusy) return
    setGhostBusy(true)
    setGhostError(null)
    try {
      await api.post(`/api/table/${encodeURIComponent(doctype)}`, ghost)
      setGhost(null)
      await onSaved()
    } catch (err) {
      setGhostError(err instanceof ApiError ? err.message : 'Could not create row')
    } finally {
      setGhostBusy(false)
    }
  }

  return (
    <>
      <p className="mb-2 text-xs text-[var(--color-ink-faint)]">
        Every cell is directly editable — click and type. A row saves when you leave it. The last
        line is a new row: type into it and press <kbd>Enter</kbd>.
      </p>
      <div className="fc-card overflow-x-auto" data-testid="sheet-view">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-subtle)] text-left">
            <tr>
              <th className="w-7 border-b border-[var(--color-border)]" />
              {columns.map((col) => (
                <th
                  key={col.column_name}
                  className="border-b border-[var(--color-border)] px-3 py-2 font-medium text-[var(--color-ink-muted)]"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="sheet-rows">
            {rows.map((row, r) => (
              <tr
                key={String(row.name)}
                data-row-name={String(row.name)}
                onBlur={rowBlur(String(row.name))}
                className="border-b border-[var(--color-border)] last:border-0 focus-within:bg-[var(--color-subtle)]/60 hover:bg-[var(--color-subtle)]/40"
              >
                <td className="w-7 px-2 text-center">
                  <RowStatusDot status={status[String(row.name)]} dirty={dirty.has(String(row.name))} />
                </td>
                {columns.map((col, c) => (
                  <td
                    key={col.column_name}
                    data-testid={`sheet-cell-${col.column_name}`}
                    className="border-r border-[var(--color-border)] last:border-r-0"
                  >
                    {c === 0 || !editableInline(meta, col) ? (
                      <span className="block px-3 py-1.5 font-mono text-[13px] text-[var(--color-ink-muted)]">
                        {cellText(row[col.column_name], col.column_type, settings)}
                      </span>
                    ) : col.column_type === 'Check' ? (
                      <span className="block px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={Boolean(row[col.column_name])}
                          onChange={(e) => edit(r, col.column_name, e.target.checked)}
                        />
                      </span>
                    ) : col.column_type === 'Choice' && choiceOptions(meta, col.column_name).length ? (
                      <select
                        value={String(row[col.column_name] ?? '')}
                        onChange={(e) => edit(r, col.column_name, e.target.value)}
                        className="w-full bg-transparent px-3 py-1.5 text-sm text-[var(--color-ink)] outline-none focus:bg-[var(--color-surface)]"
                      >
                        <option value="">—</option>
                        {choiceOptions(meta, col.column_name).map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={String(row[col.column_name] ?? '')}
                        onChange={(e) => edit(r, col.column_name, e.target.value)}
                        className="w-full bg-transparent px-3 py-1.5 text-sm text-[var(--color-ink)] outline-none focus:bg-[var(--color-surface)] focus:shadow-[inset_0_0_0_2px_var(--color-brand)]"
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-[var(--color-subtle)]/30" data-testid="sheet-ghost-row">
              <td className="w-7 px-2 text-center text-[var(--color-ink-faint)]">＋</td>
              {columns.map((col, c) => (
                <td
                  key={col.column_name}
                  className="border-r border-[var(--color-border)] last:border-r-0"
                >
                  {c === 0 || !editableInline(meta, col) ? (
                    <span className="block px-3 py-1.5 text-[13px] italic text-[var(--color-ink-faint)]">
                      {c === 0 ? 'new row…' : '…'}
                    </span>
                  ) : (
                    <input
                      value={String(ghost?.[col.column_name] ?? '')}
                      placeholder="…"
                      disabled={ghostBusy}
                      data-testid={`sheet-ghost-${col.column_name}`}
                      onChange={(e) =>
                        setGhost((g) => ({ ...(g ?? {}), [col.column_name]: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === 'Enter' && void commitGhost()}
                      className="w-full bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-[var(--color-ink-faint)] focus:bg-[var(--color-surface)] focus:shadow-[inset_0_0_0_2px_var(--color-brand)]"
                    />
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {ghostError && (
        <p className="mt-2 text-xs text-[var(--color-danger)]" data-testid="sheet-ghost-error">
          {ghostError}
        </p>
      )}
    </>
  )
}
