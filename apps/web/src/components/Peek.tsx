import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { api, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, listColumns, useMeta, type ColumnDef } from '../lib/meta'
import { formatValue, useSettings } from '../lib/settings'
import { connectionLabel, useConnections, type Filter } from '../lib/connections'
import { Indicator } from './ListView'

type Row = Record<string, unknown>

// Relational navigation (#100, pattern 3 — peek stack): clicking a reference
// slides a read-only panel over the current screen instead of navigating
// away. Panels stack (record → its connections → a related list → a row in
// it …); Esc or ✕ closes the whole stack, ← pops one level, ↗ commits to a
// real navigation. Airtable's expanded records + Glide's pushed detail
// screens, generalized over Table metadata.

export type PeekFrame =
  | { kind: 'record'; table: string; name: string }
  | { kind: 'list'; table: string; filters: Filter[]; title: string }

const PeekContext = createContext<{ push: (f: PeekFrame) => void; available: boolean }>({
  push: () => {},
  available: false,
})

export function usePeek() {
  return useContext(PeekContext)
}

export function PeekProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<PeekFrame[]>([])
  const push = useCallback((f: PeekFrame) => setStack((s) => [...s, f]), [])
  const value = useMemo(() => ({ push, available: true }), [push])

  // A real navigation underneath (breadcrumb, sidebar, ↗) closes the stack —
  // peeking never leaves a stale overlay over a page it wasn't opened from.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => setStack([]), [pathname])

  useEffect(() => {
    if (!stack.length) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setStack([])
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [stack.length])

  return (
    <PeekContext.Provider value={value}>
      {children}
      {stack.length > 0 && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/25"
            data-testid="peek-scrim"
            onClick={() => setStack([])}
          />
          {stack.map((frame, i) => (
            <PeekPanel
              key={i}
              frame={frame}
              depth={i}
              count={stack.length}
              onPop={() => setStack((s) => s.slice(0, -1))}
              onClose={() => setStack([])}
              push={push}
            />
          ))}
        </>
      )}
    </PeekContext.Provider>
  )
}

function PeekPanel({
  frame,
  depth,
  count,
  onPop,
  onClose,
  push,
}: {
  frame: PeekFrame
  depth: number
  count: number
  onPop: () => void
  onClose: () => void
  push: (f: PeekFrame) => void
}) {
  const navigate = useNavigate()
  const isTop = depth === count - 1
  const offset = (count - 1 - depth) * 16
  const title = frame.kind === 'record' ? frame.name : frame.title

  function openFull() {
    onClose()
    if (frame.kind === 'record')
      navigate({
        to: '/admin/$doctype/$name',
        params: { doctype: frame.table, name: frame.name },
        search: { prefill: undefined },
      })
    else
      navigate({
        to: '/admin/$doctype',
        params: { doctype: frame.table },
        search: { filters: frame.filters.length ? JSON.stringify(frame.filters) : undefined },
      })
  }

  return (
    <div
      data-testid={`peek-panel-${depth}`}
      className="fixed bottom-0 top-0 z-50 flex w-[min(430px,92vw)] flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl"
      style={{ right: offset, filter: isTop ? undefined : 'brightness(0.97)' }}
    >
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 py-2">
        {depth > 0 && (
          <button
            onClick={onPop}
            aria-label="Back one level"
            data-testid="peek-back"
            className="rounded px-1.5 py-0.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]"
          >
            ←
          </button>
        )}
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-sm font-semibold text-[var(--color-ink)]" data-testid="peek-title">
            {title}
          </div>
          <div className="text-[11px] text-[var(--color-ink-faint)]">
            {frame.table} · level {depth + 1} of {count}
          </div>
        </div>
        <button
          onClick={openFull}
          data-testid="peek-open-full"
          className="rounded px-1.5 py-0.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]"
          title="Open full page"
        >
          ↗
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          data-testid="peek-close"
          className="rounded px-1.5 py-0.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {frame.kind === 'record' ? (
          <PeekRecord table={frame.table} name={frame.name} push={push} />
        ) : (
          <PeekList table={frame.table} filters={frame.filters} push={push} />
        )}
      </div>
    </div>
  )
}

// Read-only field values + child grids + the row's connections. Reference
// values push a deeper record frame; connection groups push list frames.
function PeekRecord({
  table,
  name,
  push,
}: {
  table: string
  name: string
  push: (f: PeekFrame) => void
}) {
  const meta = useMeta(table)
  const settings = useSettings()
  const doc = useQueryDoc(table, name)
  const cnx = useConnections(table, name)

  if (meta.isLoading || doc.isLoading)
    return <p className="p-4 text-sm text-[var(--color-ink-faint)]">Loading…</p>
  if (meta.isError || doc.isError)
    return <p className="p-4 text-sm text-[var(--color-danger)]">Cannot load {table} {name}</p>

  const m = meta.data!
  const d = doc.data!
  const fields = m.columns.filter(
    (f) => !NO_COLUMN_TYPES.has(f.column_type) || f.column_type === 'Sub-table',
  )

  return (
    <div data-testid="peek-record">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
        {fields
          .filter((f) => f.column_type !== 'Sub-table' && !f.hidden)
          .map((f) => (
            <div key={f.column_name} className="min-w-0">
              <dt className="fc-label mb-0">{f.label ?? f.column_name}</dt>
              <dd className="truncate text-sm text-[var(--color-ink)]">
                <PeekValue field={f} value={d[f.column_name]} settings={settings} push={push} />
              </dd>
            </div>
          ))}
      </dl>
      {fields
        .filter((f) => f.column_type === 'Sub-table' && !f.hidden)
        .map((f) => (
          <PeekChildGrid key={f.column_name} field={f} rows={(d[f.column_name] as Row[]) ?? []} push={push} />
        ))}
      {(cnx.data?.connections.length ?? 0) > 0 && (
        <div className="border-t border-[var(--color-border)]">
          <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Connections
          </div>
          {cnx.data!.connections.map((c) => (
            <button
              key={`${c.table}:${c.column}:${c.via ?? ''}`}
              onClick={() =>
                push({ kind: 'list', table: c.table, filters: c.filters, title: connectionLabel(c) })
              }
              data-testid={`peek-connection-${c.table}`}
              className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-[var(--color-subtle)]"
            >
              <span className={c.count ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]'}>
                {connectionLabel(c)}
              </span>
              <span
                className={`fc-pill ${c.count ? 'bg-[var(--color-brand-tint)] text-[var(--color-brand)]' : 'bg-[var(--color-subtle)] text-[var(--color-ink-faint)]'}`}
              >
                {c.count}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PeekValue({
  field,
  value,
  settings,
  push,
}: {
  field: ColumnDef
  value: unknown
  settings: ReturnType<typeof useSettings>
  push: (f: PeekFrame) => void
}) {
  if (value == null || value === '') return <span className="text-[var(--color-ink-faint)]">—</span>
  if (field.column_type === 'Reference' && field.reference_table)
    return (
      <button
        onClick={() => push({ kind: 'record', table: field.reference_table!, name: String(value) })}
        className="font-medium text-[var(--color-brand)] hover:underline"
        data-testid={`peek-ref-${field.column_name}`}
      >
        {String(value)}
      </button>
    )
  if (field.column_type === 'Check') return <span>{value ? '✓' : '✗'}</span>
  if (field.column_type === 'Choice') return <Indicator value={String(value)} />
  return <span>{formatValue(field.column_type, value, settings) || String(value)}</span>
}

function PeekChildGrid({
  field,
  rows,
  push,
}: {
  field: ColumnDef
  rows: Row[]
  push: (f: PeekFrame) => void
}) {
  const childMeta = useMeta(field.row_table ?? '')
  const settings = useSettings()
  if (!childMeta.data || !rows.length) return null
  const cols = childMeta.data.columns
    .filter((f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden)
    .slice(0, 4)
  return (
    <div className="border-t border-[var(--color-border)] px-4 py-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        {field.label ?? field.column_name} ({rows.length})
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.column_name} className="border-b border-[var(--color-border)] py-1 pr-2 text-left font-medium text-[var(--color-ink-muted)]">
                {c.label ?? c.column_name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.name ?? i)}>
              {cols.map((c) => (
                <td key={c.column_name} className="border-b border-[var(--color-border)] py-1 pr-2 last:border-0">
                  {c.column_type === 'Reference' && c.reference_table && r[c.column_name] ? (
                    <button
                      onClick={() =>
                        push({ kind: 'record', table: c.reference_table!, name: String(r[c.column_name]) })
                      }
                      className="text-[var(--color-brand)] hover:underline"
                    >
                      {String(r[c.column_name])}
                    </button>
                  ) : (
                    <span>{formatValue(c.column_type, r[c.column_name], settings) || '—'}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PeekList({
  table,
  filters,
  push,
}: {
  table: string
  filters: Filter[]
  push: (f: PeekFrame) => void
}) {
  const meta = useMeta(table)
  const settings = useSettings()
  const columns = meta.data ? listColumns(meta.data) : []
  const list = useQueryList(table, filters, columns.map((c) => c.column_name))

  if (meta.isLoading || list.isLoading)
    return <p className="p-4 text-sm text-[var(--color-ink-faint)]">Loading…</p>
  if (meta.isError || list.isError)
    return <p className="p-4 text-sm text-[var(--color-danger)]">Cannot load {table}</p>

  const rows = list.data!.data
  return (
    <div data-testid="peek-list">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.column_name} className="border-b border-[var(--color-border)] px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={String(r.name)}
              className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-subtle)]"
              onClick={() => push({ kind: 'record', table, name: String(r.name) })}
              data-testid="peek-list-row"
            >
              {columns.map((c, i) => (
                <td key={c.column_name} className={`px-3 py-1.5 ${i === 0 ? 'font-medium text-[var(--color-brand)]' : ''}`}>
                  {formatValue(c.column_type, r[c.column_name], settings) || '—'}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-[var(--color-ink-faint)]">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {list.data!.total > rows.length && (
        <p className="px-3 py-2 text-xs text-[var(--color-ink-faint)]">
          Showing {rows.length} of {list.data!.total} — open full ↗ for everything
        </p>
      )}
    </div>
  )
}

// Local query wrappers (same keys as FormView/ListView so caches share).
function useQueryDoc(table: string, name: string) {
  return useQuery({
    queryKey: ['doc', table, name],
    queryFn: () =>
      api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`),
  })
}

function useQueryList(table: string, filters: Filter[], fields: string[]) {
  return useQuery({
    queryKey: ['peek-list', table, JSON.stringify(filters), fields],
    enabled: fields.length > 0,
    queryFn: () => listResource(table, { filters, fields, limit_page_length: 20 }),
  })
}
