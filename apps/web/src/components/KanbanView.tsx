import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { ApiError, api, listResource } from '../lib/api'
import { useMeta } from '../lib/meta'

type Row = Record<string, unknown>

// UI-020: Kanban board grouped by a Select field, with pointer-based
// drag-and-drop between columns. Dropping a card in a new column writes the
// grouping field back to the document.
export function KanbanView({
  doctype,
  groupBy,
  onGroupByChange,
}: {
  doctype: string
  groupBy?: string
  onGroupByChange?: (field: string | undefined) => void
}) {
  const meta = useMeta(doctype)
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ name: string; from: string } | null>(null)

  const selectFields = useMemo(
    () => (meta.data?.fields ?? []).filter((f) => f.fieldtype === 'Select'),
    [meta.data],
  )
  const field = groupBy && selectFields.some((f) => f.fieldname === groupBy)
    ? groupBy
    : selectFields[0]?.fieldname

  const titleField = meta.data?.title_field || 'name'

  const rows = useQuery({
    queryKey: ['kanban', doctype, field],
    enabled: Boolean(meta.data && field),
    queryFn: () =>
      listResource<Row>(doctype, {
        fields: [...new Set(['name', field!, titleField])],
        order_by: 'modified desc',
        limit_page_length: 500,
      }),
  })

  if (meta.isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (!field)
    return <p className="text-sm text-[var(--color-ink-muted)]" data-testid="kanban-no-select">This DocType has no Select field to group by.</p>

  const options = (selectFields.find((f) => f.fieldname === field)?.options ?? '')
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean)
  const columns = [...options, ...(options.length ? [] : [])]

  const data = rows.data?.data ?? []
  const byColumn = new Map<string, Row[]>()
  for (const col of columns) byColumn.set(col, [])
  for (const row of data) {
    const key = String(row[field] ?? '')
    if (!byColumn.has(key)) byColumn.set(key, [])
    byColumn.get(key)!.push(row)
  }

  async function moveCard(name: string, from: string, to: string) {
    if (from === to) return
    setError(null)
    // Optimistic: refetch after the write.
    try {
      const doc = await api.get<Row>(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)
      await api.put(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
        [field!]: to,
        modified: doc.modified,
      })
      await queryClient.invalidateQueries({ queryKey: ['kanban', doctype, field] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Move failed')
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragging) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const colEl = el?.closest('[data-column]') as HTMLElement | null
    const to = colEl?.getAttribute('data-column')
    const card = dragging
    setDragging(null)
    if (to) void moveCard(card.name, card.from, to)
  }

  return (
    <div data-testid="kanban-view" onPointerUp={onPointerUp}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">{doctype} — Kanban</h1>
          <span className="text-xs text-[var(--color-ink-muted)]" data-testid="kanban-total">
            {data.length} cards
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            Group by
            <select
              value={field}
              onChange={(e) => onGroupByChange?.(e.target.value)}
              className="fc-input w-44"
              data-testid="kanban-groupby"
            >
              {selectFields.map((f) => (
                <option key={f.fieldname} value={f.fieldname}>
                  {f.label ?? f.fieldname}
                </option>
              ))}
            </select>
          </label>
          <RouterLink
            to="/desk/$doctype"
            params={{ doctype }}
            search={{ filters: undefined }}
            className="fc-btn"
            data-testid="kanban-to-list"
          >
            List view
          </RouterLink>
        </div>
      </div>

      {error && (
        <p className="mb-3 text-sm text-[var(--color-danger)]" data-testid="kanban-error">
          {error}
        </p>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {[...byColumn.keys()].map((col) => (
          <div
            key={col || '(empty)'}
            data-column={col}
            data-testid={`kanban-column-${col || 'empty'}`}
            className="flex w-64 shrink-0 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-2"
          >
            <div className="mb-2 flex items-center justify-between px-1 text-sm font-medium text-[var(--color-ink)]">
              <span>{col || '(none)'}</span>
              <span className="fc-pill bg-[var(--color-canvas)] text-[var(--color-ink-muted)]" data-testid={`kanban-count-${col || 'empty'}`}>
                {byColumn.get(col)!.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {byColumn.get(col)!.map((row) => (
                <div
                  key={String(row.name)}
                  data-testid="kanban-card"
                  data-card={String(row.name)}
                  onPointerDown={() => setDragging({ name: String(row.name), from: col })}
                  className={`cursor-grab rounded-md border border-[var(--color-border)] bg-white p-2 text-sm shadow-sm ${
                    dragging?.name === row.name ? 'opacity-50' : ''
                  }`}
                >
                  <RouterLink
                    to="/desk/$doctype/$name"
                    params={{ doctype, name: String(row.name) }}
                    className="font-medium text-[var(--color-brand)] hover:underline"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {String(row[titleField] ?? row.name)}
                  </RouterLink>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
