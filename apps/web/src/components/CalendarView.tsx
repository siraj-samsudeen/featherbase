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

// UI-021: month calendar for DocTypes with a Date field. Documents appear on
// their date; dragging an event to another day writes the date field back.
export function CalendarView({ doctype }: { doctype: string }) {
  const meta = useMeta(doctype)
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ name: string; from: string } | null>(null)
  // Month being viewed (first of month). Defaults to the current month.
  const [view, setView] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const dateFields = useMemo(
    () => (meta.data?.fields ?? []).filter((f) => f.fieldtype === 'Date'),
    [meta.data],
  )
  const field = dateFields[0]?.fieldname
  const titleField = meta.data?.title_field || 'name'

  const rows = useQuery({
    queryKey: ['calendar', doctype, field],
    enabled: Boolean(meta.data && field),
    queryFn: () =>
      listResource<Row>(doctype, {
        fields: [...new Set(['name', field!, titleField])],
        order_by: field!,
        limit_page_length: 1000,
      }),
  })

  if (meta.isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (!field)
    return (
      <p className="text-sm text-[var(--color-ink-muted)]" data-testid="calendar-no-date">
        This DocType has no Date field.
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
      const doc = await api.get<Row>(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)
      await api.put(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
        [field!]: to,
        modified: doc.modified,
      })
      await queryClient.invalidateQueries({ queryKey: ['calendar', doctype, field] })
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
    if (to) void moveEvent(ev.name, ev.from, to)
  }

  const monthLabel = view.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const shiftMonth = (delta: number) => setView(new Date(view.getFullYear(), view.getMonth() + delta, 1))

  return (
    <div data-testid="calendar-view" onPointerUp={onPointerUp}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">{doctype} — Calendar</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} className="fc-btn" data-testid="cal-prev">‹</button>
            <span className="min-w-40 text-center text-sm font-medium" data-testid="cal-month">{monthLabel}</span>
            <button onClick={() => shiftMonth(1)} className="fc-btn" data-testid="cal-next">›</button>
          </div>
        </div>
        <RouterLink to="/desk/$doctype" params={{ doctype }} search={{ filters: undefined }} className="fc-btn" data-testid="cal-to-list">
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
                    key={String(row.name)}
                    data-testid="cal-event"
                    data-event={String(row.name)}
                    onPointerDown={() => setDragging({ name: String(row.name), from: key })}
                    className={`cursor-grab truncate rounded bg-[var(--color-brand-tint)] px-1 py-0.5 text-xs text-[var(--color-brand)] ${
                      dragging?.name === row.name ? 'opacity-50' : ''
                    }`}
                  >
                    <RouterLink
                      to="/desk/$doctype/$name"
                      params={{ doctype, name: String(row.name) }}
                      className="hover:underline"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {String(row[titleField] ?? row.name)}
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
