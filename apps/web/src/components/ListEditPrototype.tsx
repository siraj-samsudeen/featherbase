// PROTOTYPE — throwaway UX exploration: Excel-like editing in the list view.
// Mounted on the real /admin/$doctype route via ?variant=a|b|c so each option
// is judged against the real shell, tokens, and data. Saves are STUBBED —
// edits live in local state with fake latency; nothing PATCHes the server.
// (Variant A embeds the real FormView, whose own Save is the normal form path.)
//   a — Side-peek: row click opens the form in a right drawer; list stays put.
//   b — Excel cells: click selects, double-click/Enter/F2/typing edits,
//       Tab/Enter move on, leaving a row autosaves it (row flash).
//   c — Datasheet: every cell is always an input (Access-style) + ghost
//       new-row at the bottom.
// Delete this file (and its router hook) once a variant wins.
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { listResource } from '../lib/api'
import { listColumns, useMeta, type TableMeta } from '../lib/meta'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { FormView } from './FormView'

type Row = Record<string, unknown>
type Col = { column_name: string; label: string; column_type: string }

const VARIANTS = [
  { key: 'a', label: 'A — Side-peek' },
  { key: 'b', label: 'B — Excel cells' },
  { key: 'c', label: 'C — Datasheet' },
] as const

export function ListEditPrototype({ doctype, variant }: { doctype: string; variant: string }) {
  const meta = useMeta(doctype)
  const settings = useSettings()
  const columns = meta.data ? listColumns(meta.data) : []
  const list = useQuery({
    queryKey: ['proto-list', doctype],
    enabled: Boolean(meta.data),
    queryFn: () =>
      listResource(doctype, {
        fields: columns.map((c) => c.column_name),
        limit_page_length: 20,
      }),
  })

  // Local editable copy — the prototype's "database". Reset per table/refetch.
  const [rows, setRows] = useState<Row[]>([])
  useEffect(() => {
    if (list.data) setRows(list.data.data.map((r) => ({ ...r })))
  }, [list.data])

  if (meta.isLoading || list.isLoading)
    return <p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>
  if (meta.isError || list.isError || !meta.data)
    return <p className="text-sm text-[var(--color-danger)]">Cannot load {doctype}</p>

  const v = VARIANTS.some((x) => x.key === variant) ? variant : 'a'
  return (
    <div>
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">{doctype}</h1>
          <p className="text-xs text-[var(--color-ink-faint)]">
            UX prototype — edits are local only, nothing is written to the server
            {v === 'a' ? ' (the drawer’s own Save button is the real form save)' : ''}
          </p>
        </div>
        <Link
          to="/admin/$doctype"
          params={{ doctype }}
          search={{ filters: undefined, variant: undefined }}
          className="fc-btn"
        >
          Exit prototype
        </Link>
      </header>
      {v === 'a' && (
        <SidePeek doctype={doctype} rows={rows} columns={columns} settings={settings} />
      )}
      {v === 'b' && (
        <ExcelCells
          doctype={doctype}
          meta={meta.data}
          rows={rows}
          setRows={setRows}
          columns={columns}
          settings={settings}
        />
      )}
      {v === 'c' && (
        <Datasheet
          meta={meta.data}
          rows={rows}
          setRows={setRows}
          columns={columns}
          settings={settings}
        />
      )}
      <Switcher doctype={doctype} current={v} />
    </div>
  )
}

// ---------------------------------------------------------------- switcher

function Switcher({ doctype, current }: { doctype: string; current: string }) {
  const navigate = useNavigate()
  if (process.env.NODE_ENV === 'production') return null
  const idx = VARIANTS.findIndex((x) => x.key === current)
  const go = (delta: number) => {
    const next = VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length]
    void navigate({
      to: '/admin/$doctype',
      params: { doctype },
      search: { filters: undefined, variant: next.key },
      replace: true,
    })
  }
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm text-white shadow-lg">
      <button onClick={() => go(-1)} aria-label="Previous variant" className="hover:text-[var(--color-brand)]">
        ←
      </button>
      <span className="font-medium">{VARIANTS[idx].label}</span>
      <button onClick={() => go(1)} aria-label="Next variant" className="hover:text-[var(--color-brand)]">
        →
      </button>
    </div>
  )
}

// ------------------------------------------------------------ shared bits

function cellText(value: unknown, columnType: string, settings: Settings): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  return formatValue(columnType, value, settings) || '—'
}

function choiceOptions(meta: TableMeta, col: string): string[] {
  const def = meta.columns.find((c) => c.column_name === col)
  return (def?.choices ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function isEditable(meta: TableMeta, col: Col): boolean {
  if (col.column_name === 'name') return false
  const def = meta.columns.find((c) => c.column_name === col.column_name)
  return Boolean(def && !def.read_only)
}

// Fake per-row autosave: idle → saving → saved → idle. Local state only.
type RowStatus = 'saving' | 'saved'
function useFakeSave() {
  const [status, setStatus] = useState<Record<string, RowStatus>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])
  const save = (rowName: string) => {
    clearTimeout(timers.current[rowName])
    setStatus((s) => ({ ...s, [rowName]: 'saving' }))
    timers.current[rowName] = setTimeout(() => {
      setStatus((s) => ({ ...s, [rowName]: 'saved' }))
      timers.current[rowName] = setTimeout(() => {
        setStatus(({ [rowName]: _, ...rest }) => rest)
      }, 1400)
    }, 400)
  }
  return { status, save }
}

function RowStatusDot({ status, dirty }: { status?: RowStatus; dirty?: boolean }) {
  if (status === 'saving')
    return <span className="text-xs text-[var(--color-ink-faint)]" title="Saving…">⋯</span>
  if (status === 'saved')
    return <span className="text-xs" style={{ color: '#16a34a' }} title="Saved">✓</span>
  if (dirty) return <span className="text-xs" style={{ color: '#ea580c' }} title="Unsaved">●</span>
  return null
}

// ------------------------------------------------- variant A: side-peek

function SidePeek({
  doctype,
  rows,
  columns,
  settings,
}: {
  doctype: string
  rows: Row[]
  columns: Col[]
  settings: Settings
}) {
  const [peek, setPeek] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPeek(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm">
          <Head columns={columns} gutter={false} />
          <tbody>
            {rows.map((row) => (
              <tr
                key={String(row.name)}
                onClick={() => setPeek(String(row.name))}
                className={`cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-subtle)] ${
                  peek === String(row.name) ? 'bg-[var(--color-subtle)]' : ''
                }`}
              >
                {columns.map((col, i) => (
                  <td key={col.column_name} className="px-3 py-2">
                    <span
                      className={
                        i === 0
                          ? 'font-mono text-[13px] font-medium text-[var(--color-brand)]'
                          : 'text-[var(--color-ink)]'
                      }
                    >
                      {cellText(row[col.column_name], col.column_type, settings)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {peek && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setPeek(null)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-[600px] max-w-[90vw] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
              <span className="text-sm font-medium text-[var(--color-ink-muted)]">
                {doctype} · {peek}
              </span>
              <span className="flex items-center gap-2">
                <Link
                  to="/admin/$doctype/$name"
                  params={{ doctype, name: peek }}
                  search={{ prefill: undefined }}
                  className="fc-btn text-xs"
                >
                  Open full page ↗
                </Link>
                <button onClick={() => setPeek(null)} aria-label="Close" className="fc-btn text-xs">
                  ✕
                </button>
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <FormView key={peek} doctype={doctype} name={peek} />
            </div>
          </aside>
        </>
      )}
    </>
  )
}

// ---------------------------------------------- variant B: Excel cells

function ExcelCells({
  doctype,
  meta,
  rows,
  setRows,
  columns,
  settings,
}: {
  doctype: string
  meta: TableMeta
  rows: Row[]
  setRows: React.Dispatch<React.SetStateAction<Row[]>>
  columns: Col[]
  settings: Settings
}) {
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const dirtyRows = useRef(new Set<string>())
  const { status, save } = useFakeSave()
  const gridRef = useRef<HTMLDivElement>(null)

  const startEdit = (r: number, c: number, seed?: string) => {
    if (!isEditable(meta, columns[c])) return
    setSel({ r, c })
    setEditing(true)
    setDraft(seed ?? String(rows[r][columns[c].column_name] ?? ''))
  }

  // Commit the draft into the row; autosave fires when selection LEAVES the row.
  const commit = (move: 'down' | 'right' | 'stay') => {
    if (sel && editing) {
      const { r, c } = sel
      const key = columns[c].column_name
      const before = String(rows[r][key] ?? '')
      if (draft !== before) {
        setRows((rs) => rs.map((row, i) => (i === r ? { ...row, [key]: draft } : row)))
        dirtyRows.current.add(String(rows[r].name))
      }
    }
    setEditing(false)
    if (sel) moveSel(move === 'down' ? { dr: 1 } : move === 'right' ? { dc: 1 } : {})
    gridRef.current?.focus()
  }

  const moveSel = ({ dr = 0, dc = 0 }: { dr?: number; dc?: number }) => {
    setSel((s) => {
      if (!s) return s
      const r = Math.min(Math.max(s.r + dr, 0), rows.length - 1)
      const c = Math.min(Math.max(s.c + dc, 0), columns.length - 1)
      // Leaving a dirty row = the autosave moment (per-row PATCH in real life).
      if (r !== s.r) {
        const leavingName = String(rows[s.r].name)
        if (dirtyRows.current.delete(leavingName)) save(leavingName)
      }
      return { r, c }
    })
  }

  const onGridKey = (e: React.KeyboardEvent) => {
    if (editing || !sel) return
    if (e.key === 'ArrowDown') (e.preventDefault(), moveSel({ dr: 1 }))
    else if (e.key === 'ArrowUp') (e.preventDefault(), moveSel({ dr: -1 }))
    else if (e.key === 'ArrowRight') (e.preventDefault(), moveSel({ dc: 1 }))
    else if (e.key === 'ArrowLeft') (e.preventDefault(), moveSel({ dc: -1 }))
    else if (e.key === 'Tab') (e.preventDefault(), moveSel({ dc: e.shiftKey ? -1 : 1 }))
    else if (e.key === 'Enter' || e.key === 'F2') (e.preventDefault(), startEdit(sel.r, sel.c))
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      startEdit(sel.r, sel.c, e.key) // type-to-overwrite, like Excel
    }
  }

  // Clicking outside the grid while a row is dirty also autosaves it.
  const onGridBlur = (e: React.FocusEvent) => {
    if (gridRef.current?.contains(e.relatedTarget as Node)) return
    for (const name of dirtyRows.current) save(name)
    dirtyRows.current.clear()
  }

  return (
    <>
      <p className="mb-2 text-xs text-[var(--color-ink-faint)]">
        Click a cell, then: type or <kbd>Enter</kbd>/<kbd>F2</kbd> to edit · <kbd>Tab</kbd>/
        <kbd>Enter</kbd> to move · arrows navigate · a row autosaves when you leave it
      </p>
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKey}
        onBlur={onGridBlur}
        className="fc-card overflow-x-auto outline-none"
      >
        <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <Head columns={columns} gutter />
          <tbody>
            {rows.map((row, r) => (
              <tr key={String(row.name)} className="border-b border-[var(--color-border)] last:border-0">
                <td className="w-7 px-2 text-center">
                  <RowStatusDot
                    status={status[String(row.name)]}
                    dirty={dirtyRows.current.has(String(row.name))}
                  />
                </td>
                {columns.map((col, c) => {
                  const selected = sel?.r === r && sel?.c === c
                  const editable = isEditable(meta, col)
                  return (
                    <td
                      key={col.column_name}
                      onClick={() => (setSel({ r, c }), setEditing(false), gridRef.current?.focus())}
                      onDoubleClick={() => startEdit(r, c)}
                      className={`relative border-r border-[var(--color-border)] px-3 py-1.5 last:border-r-0 ${
                        selected ? 'z-10' : ''
                      } ${editable ? 'cursor-cell' : 'cursor-default bg-[var(--color-subtle)]/40'}`}
                      style={
                        selected
                          ? { boxShadow: 'inset 0 0 0 2px var(--color-brand)', borderRadius: 2 }
                          : undefined
                      }
                    >
                      {selected && editing ? (
                        <CellEditor
                          columnType={col.column_type}
                          options={choiceOptions(meta, col.column_name)}
                          value={draft}
                          onChange={setDraft}
                          onCommit={(how) => commit(how)}
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
          </tbody>
        </table>
      </div>
    </>
  )
}

// A minimal per-type editor sized to fill its cell. Real build reuses the
// form field editors; this only needs to demo the feel.
function CellEditor({
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
  const onKey = (e: React.KeyboardEvent) => {
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
        value={value === 'true' ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => onCommit('stay')}
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
      className="absolute inset-0 w-full bg-[var(--color-surface)] px-3 text-sm outline-none"
    />
  )
}

// ----------------------------------------------- variant C: datasheet

function Datasheet({
  meta,
  rows,
  setRows,
  columns,
  settings,
}: {
  meta: TableMeta
  rows: Row[]
  setRows: React.Dispatch<React.SetStateAction<Row[]>>
  columns: Col[]
  settings: Settings
}) {
  const dirtyRows = useRef(new Set<string>())
  const { status, save } = useFakeSave()
  const [ghost, setGhost] = useState<Row | null>(null)

  const edit = (r: number, key: string, value: unknown) => {
    setRows((rs) => rs.map((row, i) => (i === r ? { ...row, [key]: value } : row)))
    dirtyRows.current.add(String(rows[r].name))
  }
  // focusout bubbling from a <tr>: when focus lands outside that row, autosave it.
  const rowBlur = (name: string) => (e: React.FocusEvent<HTMLTableRowElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    if (dirtyRows.current.delete(name)) save(name)
  }
  const commitGhost = () => {
    if (!ghost) return
    const name = `new-${rows.length + 1}`
    setRows((rs) => [...rs, { ...ghost, name }])
    setGhost(null)
    save(name)
  }

  return (
    <>
      <p className="mb-2 text-xs text-[var(--color-ink-faint)]">
        Every cell is directly editable — click and type. A row autosaves when you leave it.
        The last line is a new row: type into it and press <kbd>Enter</kbd>.
      </p>
      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm">
          <Head columns={columns} gutter />
          <tbody>
            {rows.map((row, r) => (
              <tr
                key={String(row.name)}
                onBlur={rowBlur(String(row.name))}
                className="border-b border-[var(--color-border)] last:border-0 focus-within:bg-[var(--color-subtle)]/60 hover:bg-[var(--color-subtle)]/40"
              >
                <td className="w-7 px-2 text-center">
                  <RowStatusDot
                    status={status[String(row.name)]}
                    dirty={dirtyRows.current.has(String(row.name))}
                  />
                </td>
                {columns.map((col, c) => (
                  <td key={col.column_name} className="border-r border-[var(--color-border)] last:border-r-0">
                    {c === 0 || !isEditable(meta, col) ? (
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
            <tr className="bg-[var(--color-subtle)]/30">
              <td className="w-7 px-2 text-center text-[var(--color-ink-faint)]">＋</td>
              {columns.map((col, c) => (
                <td key={col.column_name} className="border-r border-[var(--color-border)] last:border-r-0">
                  {c === 0 ? (
                    <span className="block px-3 py-1.5 text-[13px] italic text-[var(--color-ink-faint)]">
                      new row…
                    </span>
                  ) : (
                    <input
                      value={String(ghost?.[col.column_name] ?? '')}
                      placeholder="…"
                      onChange={(e) =>
                        setGhost((g) => ({ ...(g ?? {}), [col.column_name]: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === 'Enter' && commitGhost()}
                      className="w-full bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-[var(--color-ink-faint)] focus:bg-[var(--color-surface)] focus:shadow-[inset_0_0_0_2px_var(--color-brand)]"
                    />
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

// ------------------------------------------------------------ table head

function Head({ columns, gutter }: { columns: Col[]; gutter: boolean }) {
  return (
    <thead className="bg-[var(--color-subtle)] text-left">
      <tr>
        {gutter && <th className="w-7 border-b border-[var(--color-border)]" />}
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
  )
}
