// List editing, Grid mode (owner-ratified 2026-08-14, prototype variant B):
// Excel-like cells over the generic list. Click selects, double-click /
// Enter / F2 / typing edits, Tab/Enter/arrows move, and a row autosaves the
// moment selection leaves it — one PATCH per touched row, changed fields
// only, through the normal row lifecycle.
import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { TableMeta } from '../lib/meta'
import type { Settings } from '../lib/settings'
import { changedFields, moveSelection, type CellSel } from '../lib/list-edit'
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

export function GridEditView({
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
  const [sel, setSel] = useState<CellSel | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const { status, save } = useRowSave(doctype, onSaved)
  const gridRef = useRef<HTMLDivElement>(null)
  // Dirty rows live in a ref: the commit→move→save sequence runs inside one
  // event, where state set a line earlier is not yet readable. Re-renders
  // that repaint the dot always accompany the mutations (setRows / status).
  const dirty = useRef(new Set<string>())
  // Latest rows, for handlers that run in the same event as a commit (a
  // click into another cell fires the editor's blur-commit first — this
  // render's `rows` doesn't have that edit yet).
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  // Server truth flows in whenever no local edit is pending — a refetch
  // mid-edit must not clobber the user's typing.
  useEffect(() => {
    if (!dirty.current.size && !editing) setRows(serverRows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRows])

  // Takes the row DATA, not an index — the caller may hold an edit newer
  // than the `rows` state this render closed over.
  function saveRowData(row: Row) {
    const name = String(row.name)
    if (!dirty.current.has(name)) return
    dirty.current.delete(name)
    const original = serverRows.find((s) => String(s.name) === name)
    if (!original) return
    void save(name, changedFields(original, row, editableColumnDefs(meta, columns))).then((ok) => {
      // A refused save keeps the row dirty — the edit is still unsynced.
      if (!ok) dirty.current.add(name)
    })
  }

  function startEdit(r: number, c: number, seed?: string) {
    if (!editableInline(meta, columns[c])) return
    setSel({ r, c })
    setEditing(true)
    setDraft(seed ?? String(rows[r][columns[c].column_name] ?? ''))
  }

  function commit(move: 'down' | 'right' | 'stay') {
    let currentRows = rows
    if (sel && editing) {
      const { r, c } = sel
      const key = columns[c].column_name
      if (draft !== String(rows[r][key] ?? '')) {
        currentRows = rows.map((row, i) => (i === r ? { ...row, [key]: draft } : row))
        setRows(currentRows)
        rowsRef.current = currentRows
        dirty.current.add(String(rows[r].name))
      }
    }
    setEditing(false)
    if (sel && move !== 'stay') {
      const delta = move === 'down' ? { dr: 1 } : { dc: 1 }
      const { sel: next, leftRow } = moveSelection(sel, delta, currentRows.length, columns.length)
      setSel(next)
      // Leaving the row is the autosave moment — with the just-committed data.
      if (leftRow || move === 'down') saveRowData(currentRows[sel.r])
    }
    gridRef.current?.focus()
  }

  function doMove(delta: { dr?: number; dc?: number }) {
    if (!sel) return
    const { sel: next, leftRow } = moveSelection(sel, delta, rows.length, columns.length)
    setSel(next)
    if (leftRow) saveRowData(rows[sel.r])
  }

  function onGridKey(e: React.KeyboardEvent) {
    if (editing || !sel) return
    if (e.key === 'ArrowDown') (e.preventDefault(), doMove({ dr: 1 }))
    else if (e.key === 'ArrowUp') (e.preventDefault(), doMove({ dr: -1 }))
    else if (e.key === 'ArrowRight') (e.preventDefault(), doMove({ dc: 1 }))
    else if (e.key === 'ArrowLeft') (e.preventDefault(), doMove({ dc: -1 }))
    else if (e.key === 'Tab') (e.preventDefault(), doMove({ dc: e.shiftKey ? -1 : 1 }))
    else if (e.key === 'Enter' || e.key === 'F2') (e.preventDefault(), startEdit(sel.r, sel.c))
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      startEdit(sel.r, sel.c, e.key) // type-to-overwrite, like Excel
    }
  }

  // Focus leaving the grid entirely is also a "left the row" moment.
  function onGridBlur(e: React.FocusEvent) {
    if (gridRef.current?.contains(e.relatedTarget as Node)) return
    rows.forEach((row) => saveRowData(row))
  }

  return (
    <>
      <p className="mb-2 text-xs text-[var(--color-ink-faint)]">
        Click a cell, then: type or <kbd>Enter</kbd> to edit · <kbd>Tab</kbd>/<kbd>Enter</kbd> to
        move · a row saves when you leave it
      </p>
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKey}
        onBlur={onGridBlur}
        data-testid="grid-view"
        className="fc-card overflow-x-auto outline-none"
      >
        <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
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
          <tbody data-testid="grid-rows">
            {rows.map((row, r) => (
              <tr
                key={String(row.name)}
                data-row-name={String(row.name)}
                className="border-b border-[var(--color-border)] last:border-0"
              >
                <td className="w-7 px-2 text-center">
                  <RowStatusDot
                    status={status[String(row.name)]}
                    dirty={dirty.current.has(String(row.name))}
                  />
                </td>
                {columns.map((col, c) => {
                  const selected = sel?.r === r && sel?.c === c
                  const editable = editableInline(meta, col)
                  return (
                    <td
                      key={col.column_name}
                      onClick={() => {
                        // Clicking into another row is a row exit too — the
                        // editor's blur-commit (if any) has already run.
                        if (sel && sel.r !== r) saveRowData(rowsRef.current[sel.r])
                        setSel({ r, c })
                        setEditing(false)
                        gridRef.current?.focus()
                      }}
                      onDoubleClick={() => startEdit(r, c)}
                      data-testid={`grid-cell-${col.column_name}`}
                      className={`relative border-r border-[var(--color-border)] px-3 py-1.5 last:border-r-0 ${
                        editable ? 'cursor-cell' : 'cursor-default bg-[var(--color-subtle)]/40'
                      }`}
                      style={
                        selected
                          ? { boxShadow: 'inset 0 0 0 2px var(--color-brand)', borderRadius: 2 }
                          : undefined
                      }
                    >
                      {selected && editing ? (
                        <GridCellEditor
                          columnType={col.column_type}
                          options={choiceOptions(meta, col.column_name)}
                          value={draft}
                          onChange={setDraft}
                          onCommit={commit}
                          onCancel={() => (setEditing(false), gridRef.current?.focus())}
                        />
                      ) : c === 0 ? (
                        <Link
                          to="/admin/$doctype/$name"
                          params={{ doctype, name: String(row.name) }}
                          search={{ prefill: undefined }}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-[13px] font-medium text-[var(--color-brand)] hover:underline"
                        >
                          {cellText(row[col.column_name], col.column_type, settings)}
                        </Link>
                      ) : (
                        <span className="text-[var(--color-ink)]">
                          {cellText(row[col.column_name], col.column_type, settings)}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-8 text-center text-[var(--color-ink-faint)]"
                >
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

// Minimal in-cell editor per column type; complex types are not editable
// inline (editableInline gates before this renders).
function GridCellEditor({
  columnType,
  options,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  columnType: string
  options: string[]
  value: string
  onChange: (v: string) => void
  onCommit: (how: 'down' | 'right' | 'stay') => void
  onCancel: () => void
}) {
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') (e.preventDefault(), onCommit('down'))
    else if (e.key === 'Tab') (e.preventDefault(), onCommit('right'))
    else if (e.key === 'Escape') (e.preventDefault(), onCancel())
    e.stopPropagation()
  }
  if (columnType === 'Choice' && options.length)
    return (
      <select
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => onCommit('stay')}
        data-testid="grid-cell-editor"
        className="absolute inset-0 w-full bg-[var(--color-surface)] px-2 text-sm outline-none"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    )
  if (columnType === 'Check')
    return (
      <select
        autoFocus
        value={['true', '1'].includes(value) ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value === 'true' ? 'true' : '')}
        onKeyDown={onKey}
        onBlur={() => onCommit('stay')}
        data-testid="grid-cell-editor"
        className="absolute inset-0 w-full bg-[var(--color-surface)] px-2 text-sm outline-none"
      >
        <option value="true">✓ yes</option>
        <option value="false">✗ no</option>
      </select>
    )
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => onCommit('stay')}
      onFocus={(e) => e.target.select()}
      data-testid="grid-cell-editor"
      className="absolute inset-0 w-full bg-[var(--color-surface)] px-3 text-sm outline-none"
    />
  )
}
