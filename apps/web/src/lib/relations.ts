import { useQueries, useQuery } from '@tanstack/react-query'
import { listResource } from './api'
import { useConnections, type Connection } from './connections'
import { dataColumns } from './list-view-columns'
import type { TableMeta } from './meta'
import { rowTitleQuery } from './row-titles'

// #910 D3: what the drill pane, the map and the tree show about one row,
// composed from reads the server already scopes by permission — the row
// itself, its counted backlinks (:connections), a group's rows (the list
// read with the connection's filters) and the titles of the rows it points
// at (the batched row-title lookup). No endpoint of its own: a link whose
// title does not come back is a row the viewer cannot read, shown with no
// name, no id and no action (checklist item 22).

type Row = Record<string, unknown>

/** One row this row points at, through one of its link columns. */
export interface ForwardLink {
  column: string
  label: string
  table: string
  row_id: string
}

const isBlank = (v: unknown) => v == null || String(v).trim() === ''

/** The row's set links, in the Table's column order: the readable Reference
 *  columns, and a sub-table row's parent. */
export function forwardLinks(meta: TableMeta, row: Row): ForwardLink[] {
  const links: ForwardLink[] = []
  if (meta.kind === 'sub_table' && typeof row.parenttype === 'string' && !isBlank(row.parent))
    links.push({ column: 'parent', label: 'Parent', table: row.parenttype, row_id: String(row.parent) })
  for (const c of dataColumns(meta))
    if (c.column_type === 'Reference' && c.reference_table && !isBlank(row[c.column_name]))
      links.push({ column: c.column_name, label: c.label ?? c.column_name, table: c.reference_table, row_id: String(row[c.column_name]) })
  return links
}

export type LinkTitle = { state: 'loading' } | { state: 'unreadable' } | { state: 'read'; title: string }

/** A title lookup's answer as the pane shows it. */
export function linkTitleState(q: { isPending: boolean; data: string | null | undefined }): LinkTitle {
  if (q.isPending || q.data === undefined) return { state: 'loading' }
  return q.data === null ? { state: 'unreadable' } : { state: 'read', title: q.data }
}

/** The titles of these rows, for this viewer, in the same order. */
export function useLinkTitles(refs: { table: string; row_id: string }[]): LinkTitle[] {
  const titles = useQueries({ queries: refs.map((r) => rowTitleQuery(r.table, r.row_id)) })
  return titles.map(linkTitleState)
}

export function useLinkTitle(table: string | undefined, rowId: string | undefined): LinkTitle {
  return useLinkTitles(table && rowId ? [{ table, row_id: rowId }] : [])[0] ?? { state: 'loading' }
}

/** A counted group of rows that point at this row. */
export interface BacklinkGroup {
  key: string
  label: string
  count: number
  connection: Connection
}

export const groupKey = (c: { table: string; column: string; via?: string | null }) => `${c.table}|${c.column}|${c.via ?? ''}`

/** One group per connection, named by its table; two links from the same
 *  table are told apart by the link column's name (`labelOf`, its label). */
export function backlinkGroups(
  connections: Connection[],
  labelOf: (c: Connection) => string = (c) => c.column,
): BacklinkGroup[] {
  const perTable = new Map<string, number>()
  for (const c of connections) perTable.set(c.table, (perTable.get(c.table) ?? 0) + 1)
  return connections.map((c) => ({
    key: groupKey(c),
    label: (perTable.get(c.table) ?? 0) > 1 ? `${c.table} · ${labelOf(c)}` : c.table,
    count: c.count,
    connection: c,
  }))
}

export function useBacklinkGroups(table: string, row: string, enabled = true) {
  const q = useConnections(table, row, enabled)
  return { ...q, groups: q.data ? backlinkGroups(q.data.connections) : undefined }
}

/** How many rows a tree group shows before "show all". */
export const TREE_PAGE = 20

/** The most rows one list read returns: "show all" shows up to this many. */
export const ALL_ROWS = 500

/** A group's rows: the connected Table's list, narrowed by the connection's
 *  filters, `limit` at a time (undefined: as many as one read returns). */
export function useGroupRows(connection: Pick<Connection, 'table' | 'filters'> | undefined, opts: { fields?: string[]; limit?: number; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['group-rows', connection?.table, JSON.stringify(connection?.filters ?? []), opts.fields ?? null, opts.limit ?? null],
    enabled: Boolean(connection) && opts.enabled !== false,
    queryFn: () => listResource(connection!.table, {
      filters: connection!.filters,
      fields: opts.fields,
      limit_page_length: opts.limit ?? ALL_ROWS,
    }),
  })
}
