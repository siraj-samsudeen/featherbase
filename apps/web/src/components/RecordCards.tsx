import { useEffect, useRef } from 'react'
import type { ListColumn } from '../lib/list-view-columns'
import type { Settings } from '../lib/settings'
import { usePrincipalLabels } from '../lib/people'
import { ListCell, cell, isPrincipalTable } from './ListRows'
import { cx } from '@featherbase/shop-floor'

type Row = Record<string, unknown>

/**
 * #1259 (Siraj, 17-Nov; mockup "Option B"): a list's rows as cards beside the
 * open record, Front's split. A card leads with the row's title (it opens the
 * record), then one line of its other listed values, where a link stays a link
 * to its row. The open card is tinted, with no outline (minimal lines); the
 * arrow keys move between cards and the record follows.
 */
export function RecordCards({ table, titleColumn, rows, columns, settings, open, onOpen }: {
  table: string
  titleColumn: string | null | undefined
  rows: Row[]
  columns: ListColumn[]
  settings: Settings
  open: string | undefined
  onOpen: (row: string) => void
}) {
  const titleCol =
    columns.find((c) => c.column_name === titleColumn) ??
    (isPrincipalTable(table) ? columns[0] : (columns[1] ?? columns[0]))
  const detail = columns.filter((c) => c !== titleCol && c.column_name !== 'row_id').slice(0, 3)
  const titleValue = (row: Row) => (titleCol ? cell(row[titleCol.column_name], titleCol.column_type, settings) : String(row.row_id))
  const shown = usePrincipalLabels(rows.map(titleValue))
  const list = useRef<HTMLUListElement>(null)
  // The open card stays in view as the arrows move through the list.
  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(open)}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open])
  return (
    <ul ref={list} aria-label="Rows" data-testid="record-cards" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
      {rows.map((row) => {
        const id = String(row.row_id)
        const on = id === open
        return (
          <li key={id} data-row-id={id} data-testid="record-card"
            className={cx('relative flex flex-col gap-0.5 rounded-lg px-3 py-2', on ? 'bg-action-tint' : 'hover:bg-subtle')}>
            {/* The title opens the record; the card around it answers to the click too. */}
            <button type="button" aria-current={on ? 'true' : undefined} onClick={() => onOpen(id)}
              className="truncate text-left text-sm font-semibold text-ink after:absolute after:inset-0 after:rounded-lg focus-visible:outline-2 focus-visible:outline-focus">
              {shown(titleValue(row)) || id}
            </button>
            {detail.length > 0 && (
              <span className="relative z-[1] flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-ink-muted">
                {detail.map((col, i) => (
                  <span key={col.column_name} className="min-w-0 truncate">
                    {i > 0 && <span aria-hidden> · </span>}
                    <ListCell row={row} col={col} table={table} settings={settings} first={false} />
                  </span>
                ))}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
