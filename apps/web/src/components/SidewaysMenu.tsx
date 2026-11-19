import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { rowDisplayTitle, type ListFilter } from 'shared'
import { ChevronDown, RecordLink, fmtCount, iconButtonClasses } from '@featherbase/shop-floor'
import { api, listResource } from '../lib/api'
import { tableLabel, useMeta } from '../lib/meta'
import { replace as replaceStep, type NavPath, type NavStep } from '../lib/nav-path'
import type { AddressNavigation } from '../lib/navigation'
import { groupOrder } from '../lib/relations'

type Row = Record<string, unknown>

// #1282 I1, the sideways step (UI owner's decision A, 19-Nov-2026): beside the path
// bar's last step, the other rows of the list or group that step came from. Choosing
// one replaces the step in place; nothing is added to the walk.

/** How many rows the menu lists, around the current one. */
export const SIDEWAYS_ROWS = 20
/** The most rows read to find where the current one sits; past it, the search reaches the rest. */
const READ_AT_MOST = 500

/** Where a step's other rows come from: a Table narrowed by filters, the row it shows, and the step for another. */
export interface Siblings {
  table: string
  filters: ListFilter[]
  rowId: string
  /** The order the rows were seen in: a group's own (as the Map and the pane list it); a list's default, none. */
  orderBy?: string
  /** The step that shows `row` in this one's place. */
  stepFor: (row: string) => NavStep
}

/** The record a step shows: the one in its pane, else its page's. */
export function shownRecord(step: NavStep | undefined): { table: string; row: string } | null {
  if (!step) return null
  if (step.pane) return { table: step.pane.table, row: step.pane.row }
  return step.screen === 'row' ? { table: step.table, row: step.row! } : null
}

/**
 * The siblings a path's last step can step sideways to, from the path alone: a
 * list with one of its own rows open in the pane (that list), or a row page reached
 * from a list of its Table (that list, with its filters). Anything else is for the
 * link rule, which reads the row (useSiblings).
 */
export function listSiblings(path: NavPath): Siblings | null {
  const here = path.steps[path.at]
  if (!here) return null
  if (here.screen === 'list' && here.pane && here.pane.table === here.table && !here.pane.group)
    return { table: here.table, filters: here.filters ?? [], rowId: here.pane.row, stepFor: (row) => ({ ...here, pane: { table: here.table, row } }) }
  const before = path.steps[path.at - 1]
  if (here.screen === 'row' && !here.pane && before?.screen === 'list' && before.table === here.table)
    return { table: here.table, filters: before.filters ?? [], rowId: here.row!, stepFor: (row) => ({ ...here, row }) }
  return null
}

/**
 * The link rule: the current record points at the previous step's record by exactly
 * one link, so its siblings are the rows pointing there by that link (a group's
 * rows, a Map group's rows). None when it points there by none, or by more than one.
 */
function useSiblings(path: NavPath): Siblings | null {
  const fromList = listSiblings(path)
  const here = path.steps[path.at]
  const record = fromList ? null : shownRecord(here)
  const came = fromList ? null : shownRecord(path.steps[path.at - 1])
  const meta = useMeta(record?.table ?? '', Boolean(record && came))
  const doc = useQuery({
    queryKey: ['doc', record?.table, record?.row],
    enabled: Boolean(record && came),
    retry: false,
    queryFn: () => api.get<Row>(`/api/table/${encodeURIComponent(record!.table)}/${encodeURIComponent(record!.row)}`),
  })
  if (fromList) return fromList
  if (!record || !came || !meta.data || !doc.data || (came.table === record.table && came.row === record.row)) return null
  const links = meta.data.columns.filter((c) => c.column_type === 'Reference' && c.reference_table === came.table && doc.data[c.column_name] === came.row)
  if (links.length !== 1) return null
  const column = links[0]!.column_name
  return {
    table: record.table,
    filters: [[column, '=', came.row]],
    rowId: record.row,
    orderBy: groupOrder(meta.data),
    stepFor: (row) => (here!.pane ? { ...here!, pane: { table: record.table, row } } : { ...here!, row }),
  }
}

/** The sideways ▾ beside the path bar's last step, and its menu; nothing where the step has no list or group. */
export function SidewaysMenu({ nav }: { nav: AddressNavigation }) {
  const siblings = useSiblings(nav.path)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  if (!siblings) return null
  return (
    <div ref={root} className="relative shrink-0"
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false) } }}>
      <button type="button" aria-label="Other rows in this list" title="Other rows in this list" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)} className={iconButtonClasses('size-7 text-ink-muted hover:text-ink')}>
        <ChevronDown aria-hidden size={14} />
      </button>
      {open && <SidewaysList nav={nav} siblings={siblings} close={() => setOpen(false)} />}
    </div>
  )
}

function SidewaysList({ nav, siblings, close }: { nav: AddressNavigation; siblings: Siblings; close: () => void }) {
  const meta = useMeta(siblings.table)
  const [q, setQ] = useState('')
  const title = meta.data?.title_column && meta.data.title_column !== 'row_id' ? meta.data.title_column : undefined
  const fields = ['row_id', ...(title ? [title] : [])]
  const all = useQuery({
    queryKey: ['sideways', siblings.table, JSON.stringify(siblings.filters), siblings.orderBy ?? null],
    enabled: Boolean(meta.data),
    queryFn: () => listResource(siblings.table, { filters: siblings.filters, fields, order_by: siblings.orderBy, limit_page_length: READ_AT_MOST }),
  })
  const found = useQuery({
    queryKey: ['sideways', siblings.table, JSON.stringify(siblings.filters), q],
    enabled: Boolean(meta.data && q.trim()),
    queryFn: () => listResource(siblings.table, {
      filters: [...siblings.filters, [title ?? 'row_id', 'like', `%${q.trim()}%`]], fields, order_by: siblings.orderBy, limit_page_length: SIDEWAYS_ROWS,
    }),
  })
  const rows = (all.data?.data ?? []) as Row[]
  const at = rows.findIndex((r) => String(r.row_id) === siblings.rowId)
  // Past 20, the window starts around the current row, not at the top.
  const start = Math.max(0, Math.min(at - Math.floor(SIDEWAYS_ROWS / 2), rows.length - SIDEWAYS_ROWS))
  const shown = q.trim() ? ((found.data?.data ?? []) as Row[]) : rows.slice(start, start + SIDEWAYS_ROWS)
  const total = all.data?.total ?? rows.length
  const pick = (row: string) => { close(); nav.replace(siblings.stepFor(row)) }
  return (
    <div role="menu" aria-label="Other rows in this list"
      className="absolute left-0 top-full z-30 mt-1 flex w-72 flex-col gap-1 rounded-xl bg-surface p-2 shadow-lg">
      <span className="px-2 text-xs text-ink-muted" data-testid="sideways-position">
        {at >= 0 ? `${fmtCount(at + 1)} of ${fmtCount(total)}` : `${fmtCount(total)}`} · {tableLabel(siblings.table, meta.data)}
      </span>
      <input type="search" aria-label="Search these rows" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)}
        className="mx-1 rounded-control bg-canvas px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-focus" />
      <ul className="flex max-h-80 flex-col overflow-y-auto">
        {meta.data && shown.map((r) => {
          const id = String(r.row_id)
          const current = id === siblings.rowId
          return (
            <li key={id} role="none" aria-current={current ? 'true' : undefined}
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${current ? 'bg-action-tint' : 'hover:bg-subtle'}`}>
              <span aria-hidden className="w-3 shrink-0 text-action">{current ? '✓' : ''}</span>
              <RecordLink table={siblings.table} rowId={id} name={rowDisplayTitle(meta.data!, r, id)}
                href={nav.href(replaceStep(nav.path, siblings.stepFor(id)))} onNavigate={() => pick(id)} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
