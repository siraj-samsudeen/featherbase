import { useQueries, useQuery } from '@tanstack/react-query'
import { listResource } from './api'
import type { Connection } from './connections'
import { dataColumns } from './list-view-columns'
import { linkRowsTable, metaQuery, type TableMeta } from './meta'
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
  for (const c of dataColumns(meta)) {
    if (c.column_type !== 'Reference' || isBlank(row[c.column_name])) continue
    // #881: a link to a row of any Table points into the Table its row names.
    const table = linkRowsTable(c) ?? (c.table_column && !isBlank(row[c.table_column]) ? String(row[c.table_column]) : null)
    if (table) links.push({ column: c.column_name, label: c.label ?? c.column_name, table, row_id: String(row[c.column_name]) })
  }
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
    label: perTable.get(c.table)! > 1 ? `${c.table} · ${labelOf(c)}` : c.table,
    count: c.count,
    connection: c,
  }))
}

/** How many rows a tree group shows before "show all". */
export const TREE_PAGE = 20

/** The most rows one list read returns: "show all" shows up to this many. */
export const ALL_ROWS = 500

/** A group's rows: the connected Table's list, narrowed by the connection's
 *  filters, `limit` at a time. */
export function useGroupRows(connection: Pick<Connection, 'table' | 'filters'>, opts: { fields: string[]; limit: number; enabled?: boolean; orderBy?: string }) {
  return useQuery({
    ...groupRowsQuery(connection, opts),
    enabled: opts.enabled !== false,
  })
}

/** The one query for a group's rows (or, with no filters, a page of a Table's rows). */
export function groupRowsQuery(connection: Pick<Connection, 'table' | 'filters'>, opts: { fields: string[]; limit: number; start?: number; orderBy?: string }) {
  return {
    queryKey: ['group-rows', connection.table, JSON.stringify(connection.filters), opts.fields, opts.limit, opts.start ?? 0, opts.orderBy ?? null],
    queryFn: () => listResource(connection.table, {
      filters: connection.filters,
      fields: opts.fields,
      order_by: opts.orderBy,
      limit_start: opts.start || undefined,
      limit_page_length: opts.limit,
    }),
  }
}

// ---------- D5: name first, then the code people use ----------

// Ids the platform makes up: content hashes, plain counters, opaque person
// ids and numbered series ("PL-.####").
const OPAQUE_ID = /^(psn|svc)_[a-z2-7]{20}$/
function generatedIds(pattern: string): boolean {
  return pattern === 'hash' || pattern === 'integer' || pattern.startsWith('opaque:') || /\.#+$/.test(pattern)
}

/** The code shown after a linked row's name: its id, when the Table has a
 *  title column and its ids are codes people use (set by a column, a source's
 *  key or the person creating the row), and the name does not already say it. */
export function shownCode(meta: Pick<TableMeta, 'title_column' | 'id_pattern' | 'data_source'>, rowId: string, title: string): string | undefined {
  if (!meta.title_column || meta.title_column === 'row_id') return undefined
  if (!meta.data_source && generatedIds(meta.id_pattern)) return undefined
  if (OPAQUE_ID.test(rowId) || rowId === title) return undefined
  return rowId
}

/** A linked row as people read it: its name, and the code that follows it. */
export type RowName = { state: 'loading' } | { state: 'unreadable' } | { state: 'read'; title: string; code?: string }

/** The names of these rows, for this viewer, in the same order (D5). */
export function useRowNames(refs: { table: string; row_id: string }[]): RowName[] {
  const titles = useLinkTitles(refs)
  const tables = [...new Set(refs.map((r) => r.table))]
  const metas = useQueries({ queries: tables.map((t) => metaQuery(t)) })
  return refs.map((ref, i) => {
    const t = titles[i]
    if (t.state !== 'read') return t
    const meta = metas[tables.indexOf(ref.table)]?.data
    return { state: 'read', title: t.title, code: meta ? shownCode(meta, ref.row_id, t.title) : undefined }
  })
}

export function useRowName(table: string | undefined, rowId: string | undefined): RowName {
  return useRowNames(table && rowId ? [{ table, row_id: rowId }] : [])[0] ?? { state: 'loading' }
}

/** What a step, a pane or a tree line says for a row the viewer cannot read. */
export const UNSEEN_ROW = 'A row you cannot see'

/** A row name as one string: "Enchakkal Supermarket · 1503", or the neutral words. */
export function rowNameText(name: RowName, loading = '…'): string {
  if (name.state === 'unreadable') return UNSEEN_ROW
  if (name.state === 'loading') return loading
  return name.code ? `${name.title} · ${name.code}` : name.title
}

/** The order a group lists its rows in: by code where rows have codes people
 *  use, else by name, so "the first 20" are the same 20 every time. */
export function groupOrder(meta: Pick<TableMeta, 'title_column' | 'id_pattern' | 'data_source'>): string | undefined {
  const title = meta.title_column && meta.title_column !== 'row_id' ? meta.title_column : undefined
  if (title && (meta.data_source || !generatedIds(meta.id_pattern))) return 'row_id asc'
  return title ? `${title} asc` : undefined
}
