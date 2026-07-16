import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { ApiError, api, listResource } from '../lib/api'
import { useMeta } from '../lib/meta'

type Row = Record<string, unknown>

const DAY_MS = 86_400_000
const DAY_W = 40 // px per day column

// Parse a 'YYYY-MM-DD' (or datetime) into a whole-day number (days since epoch,
// UTC) so bar math is timezone-independent.
function dayNum(s: unknown): number | null {
  if (!s) return null
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}
function fromDayNum(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

// UI-022: Gantt view for DocTypes with a start and an end Date field. Each
// document is a horizontal bar spanning [start, end]; dragging a bar's right
// handle rewrites the end date.
export function GanttView({ doctype }: { doctype: string }) {
  const meta = useMeta(doctype)
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  // Live resize state: which doc, and the previewed end day.
  const [resize, setResize] = useState<{ name: string; startX: number; origEnd: number; end: number } | null>(null)

  const dateFields = useMemo(
    () => (meta.data?.fields ?? []).filter((f) => f.fieldtype === 'Date'),
    [meta.data],
  )
  const startField = dateFields[0]?.fieldname
  const endField = dateFields[1]?.fieldname
  const titleField = meta.data?.title_field || 'name'

  const rows = useQuery({
    queryKey: ['gantt', doctype, startField, endField],
    enabled: Boolean(meta.data && startField && endField),
    queryFn: () =>
      listResource<Row>(doctype, {
        fields: [...new Set(['name', startField!, endField!, titleField])],
        order_by: startField!,
        limit_page_length: 1000,
      }),
  })

  if (meta.isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (!startField || !endField)
    return (
      <p className="text-sm text-[var(--color-ink-muted)]" data-testid="gantt-no-dates">
        This DocType needs two Date fields (start and end) for a Gantt view.
      </p>
    )

  // Build the set of bars with valid start ≤ end.
  const bars = (rows.data?.data ?? [])
    .map((row) => {
      const s = dayNum(row[startField])
      let e = dayNum(row[endField])
      if (s == null || e == null) return null
      if (e < s) e = s
      // A live resize overrides the stored end for its bar.
      if (resize && resize.name === row.name) e = Math.max(s, resize.end)
      return { row, name: String(row.name), s, e }
    })
    .filter((b): b is { row: Row; name: string; s: number; e: number } => b !== null)

  // Timeline range: pad one day on each side of the data.
  const today = Math.round(Date.now() / DAY_MS)
  const minS = bars.length ? Math.min(...bars.map((b) => b.s)) : today
  const maxE = bars.length ? Math.max(...bars.map((b) => b.e)) : today
  const rangeStart = minS - 1
  const rangeEnd = maxE + 1
  const totalDays = rangeEnd - rangeStart + 1
  const days = Array.from({ length: totalDays }, (_, i) => rangeStart + i)

  async function commitEnd(name: string, origEnd: number, end: number) {
    if (end === origEnd) return
    setError(null)
    try {
      const doc = await api.get<Row>(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)
      await api.put(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
        [endField!]: fromDayNum(end),
        modified: doc.modified,
      })
      await queryClient.invalidateQueries({ queryKey: ['gantt', doctype, startField, endField] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Resize failed')
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!resize) return
    const deltaDays = Math.round((e.clientX - resize.startX) / DAY_W)
    setResize({ ...resize, end: resize.origEnd + deltaDays })
  }
  function onPointerUp() {
    if (!resize) return
    const r = resize
    setResize(null)
    void commitEnd(r.name, r.origEnd, Math.max(r.end, bars.find((b) => b.name === r.name)?.s ?? r.end))
  }

  return (
    <div data-testid="gantt-view" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--color-ink)]">{doctype} — Gantt</h1>
        <RouterLink to="/desk/$doctype" params={{ doctype }} search={{ filters: undefined }} className="fc-btn" data-testid="gantt-to-list">
          List view
        </RouterLink>
      </div>

      {error && <p className="mb-3 text-sm text-[var(--color-danger)]" data-testid="gantt-error">{error}</p>}

      {bars.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-faint)]" data-testid="gantt-empty">
          No documents with both dates set.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <div style={{ width: totalDays * DAY_W + 200 }}>
            {/* Day header */}
            <div className="flex border-b border-[var(--color-border)] bg-[var(--color-subtle)]">
              <div className="shrink-0 px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)]" style={{ width: 200 }}>
                Task
              </div>
              {days.map((d) => (
                <div
                  key={d}
                  className="shrink-0 border-l border-[var(--color-border)] py-1 text-center text-[10px] text-[var(--color-ink-faint)]"
                  style={{ width: DAY_W }}
                >
                  {fromDayNum(d).slice(5)}
                </div>
              ))}
            </div>

            {/* One row per document */}
            {bars.map((b) => {
              const leftDays = b.s - rangeStart
              const spanDays = b.e - b.s + 1
              return (
                <div key={b.name} className="flex items-center border-b border-[var(--color-border)]" data-testid={`gantt-row-${b.name}`}>
                  <div className="shrink-0 truncate px-2 py-1 text-xs text-[var(--color-ink)]" style={{ width: 200 }}>
                    <RouterLink to="/desk/$doctype/$name" params={{ doctype, name: b.name }} className="hover:underline">
                      {String(b.row[titleField] ?? b.name)}
                    </RouterLink>
                  </div>
                  <div className="relative py-1.5" style={{ width: totalDays * DAY_W, height: 28 }}>
                    <div
                      data-testid={`gantt-bar-${b.name}`}
                      data-start={fromDayNum(b.s)}
                      data-end={fromDayNum(b.e)}
                      data-days={spanDays}
                      className="absolute top-1.5 flex h-4 items-center rounded bg-[var(--color-brand)]"
                      style={{ left: leftDays * DAY_W, width: spanDays * DAY_W }}
                    >
                      <span className="sr-only">{spanDays} days</span>
                      {/* Right-edge resize handle */}
                      <div
                        data-testid={`gantt-resize-${b.name}`}
                        onPointerDown={(e) => {
                          e.preventDefault()
                          setResize({ name: b.name, startX: e.clientX, origEnd: b.e, end: b.e })
                        }}
                        className="absolute right-0 top-0 h-4 w-2 cursor-ew-resize rounded-r bg-[var(--color-brand-strong,#1b6fd0)]"
                        style={{ background: 'rgba(0,0,0,0.35)' }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
