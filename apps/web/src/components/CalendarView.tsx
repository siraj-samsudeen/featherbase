import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { ApiError, api, listResource } from '../lib/api'
import { useMeta } from '../lib/meta'

type Row = Record<string, unknown>

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// UI-021: month calendar for Tables with a Date column. Rows appear on
// their date; dragging an event to another day writes the date column back.
export function CalendarView({ table }: { table: string }) {
  const meta = useMeta(table)
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ row_id: string; from: string } | null>(null)
  // Month being viewed (first of month). Defaults to the current month.
  const [view, setView] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const dateColumns = useMemo(
    () => (meta.data?.columns ?? []).filter((f) => f.column_type === 'Date'),
    [meta.data],
  )
  const field = dateColumns[0]?.column_name
  const titleColumn = meta.data?.title_column || 'row_id'

  const rows = useQuery({
    queryKey: ['calendar', table, field],
    enabled: Boolean(meta.data && field),
    queryFn: () =>
      listResource<Row>(table, {
        fields: [...new Set(['row_id', field!, titleColumn])],
        order_by: field!,
        limit_page_length: 1000,
      }),
  })

  if (meta.isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (!field)
    return (
      <p className="text-sm text-[var(--color-ink-muted)]" data-testid="calendar-no-date">
        This Table has no Date column.
      </p>
    )

  // 6-week grid starting on the Sunday on/before the 1st.
  const gridStart = new Date(view)
  gridStart.setDate(1 - view.getDay())
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    cells.push(d)
  }

  const byDate = new Map<string, Row[]>()
  for (const row of rows.data?.data ?? []) {
    const v = row[field]
    if (!v) continue
    const key = String(v).slice(0, 10)
    byDate.set(key, [...(byDate.get(key) ?? []), row])
  }

  async function moveEvent(name: string, from: string, to: string) {
    if (from === to) return
    setError(null)
    try {
      const doc = await api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`)
      await api.patch(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`, {
        [field!]: to,
        updated_at: doc.updated_at,
      })
      await queryClient.invalidateQueries({ queryKey: ['calendar', table, field] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Move failed')
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragging) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const cell = el?.closest('[data-date]') as HTMLElement | null
    const to = cell?.getAttribute('data-date')
    const ev = dragging
    setDragging(null)
    if (to) void moveEvent(ev.row_id, ev.from, to)
  }

  const monthLabel = view.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const shiftMonth = (delta: number) => setView(new Date(view.getFullYear(), view.getMonth() + delta, 1))

  return (
    <div data-testid="calendar-view" onPointerUp={onPointerUp}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">{table} — Calendar</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} className="fc-btn" data-testid="cal-prev">‹</button>
            <span className="min-w-40 text-center text-sm font-medium" data-testid="cal-month">{monthLabel}</span>
            <button onClick={() => shiftMonth(1)} className="fc-btn" data-testid="cal-next">›</button>
          </div>
        </div>
        <RouterLink to="/admin/$table" params={{ table }} search={{ filters: undefined }} className="fc-btn" data-testid="cal-to-list">
          List view
        </RouterLink>
      </div>

      {error && <p className="mb-3 text-sm text-[var(--color-danger)]" data-testid="calendar-error">{error}</p>}

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-border)]">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="bg-[var(--color-subtle)] px-2 py-1 text-center text-xs font-medium text-[var(--color-ink-muted)]">
            {d}
          </div>
        ))}
        {cells.map((d) => {
          const key = ymd(d)
          const inMonth = d.getMonth() === view.getMonth()
          return (
            <div
              key={key}
              data-date={key}
              data-testid={`cal-cell-${key}`}
              className={`min-h-24 bg-[var(--color-surface)] p-1 ${inMonth ? '' : 'opacity-50'}`}
            >
              <div className="mb-1 text-right text-xs text-[var(--color-ink-faint)]">{d.getDate()}</div>
              <div className="flex flex-col gap-1">
                {(byDate.get(key) ?? []).map((row) => (
                  <div
                    key={String(row.row_id)}
                    data-testid="cal-event"
                    data-event={String(row.row_id)}
                    onPointerDown={() => setDragging({ row_id: String(row.row_id), from: key })}
                    className={`cursor-grab truncate rounded bg-[var(--color-brand-tint)] px-1 py-0.5 text-xs text-[var(--color-brand)] ${
                      dragging?.row_id === row.row_id ? 'opacity-50' : ''
                    }`}
                  >
                    <RouterLink
                      to="/admin/$table/$name"
                      search={{ prefill: undefined }}
                      params={{ table, name: String(row.row_id) }}
                      className="hover:underline"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {String(row[titleColumn] ?? row.row_id)}
                    </RouterLink>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
