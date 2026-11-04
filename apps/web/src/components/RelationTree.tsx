import { useState, type ReactNode } from 'react'
import { keepPreviousData, useQueries, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { rowDisplayTitle } from 'shared'
import { Button, TreeOutline, type TreeNode } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { connectionsQuery, type Connection, type Filter } from '../lib/connections'
import { listFields, viewColumns } from '../lib/list-view-columns'
import { metaQuery, type TableMeta } from '../lib/meta'
import type { NavPane } from '../lib/nav-path'
import { ALL_ROWS, TREE_PAGE, backlinkGroups, forwardLinks, groupRowsQuery, shownCode, UNSEEN_ROW, type BacklinkGroup } from '../lib/relations'
import { rowTitleQuery } from '../lib/row-titles'

// #910 checklist 18–19: a tree of related rows. Each row line unfolds in
// place into what it links to and the counted groups that link to it; a
// group unfolds into its rows, the first 20, then all. Every read is one the
// server already scopes by permission (D3): a row's own values, its
// :connections, a group's list, the titles of linked rows — so a row the
// viewer cannot read is never named, and never unfolds.
//
// Lines load as they unfold: walking the tree asks the query cache for what
// each open line needs, and asks for whatever is missing.

type Row = Record<string, unknown>
type Query = { queryKey: QueryKey; queryFn: () => Promise<unknown> }

/** A top line of the tree: a row, by its name and code. */
export interface TreeRoot { table: string; row: string; label: string; code?: string }

/** A short, stable id for one line: its parent's id and a hash of what it shows. */
function lineId(parent: string, local: string): string {
  let h = 5381
  for (let i = 0; i < local.length; i++) h = ((h * 33) ^ local.charCodeAt(i)) >>> 0
  return `${parent}.${h.toString(36)}`
}

const docQuery = (table: string, row: string) => ({
  queryKey: ['doc', table, row],
  queryFn: () => api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(row)}`),
})

interface Walk { nodes: TreeNode[]; open: Map<string, NavPane>; needs: Query[] }

function useTreeWalk(build: (w: Walker) => TreeNode[]): Walk {
  const client = useQueryClient()
  const needs = new Map<string, Query>()
  const get = <T,>(q: Query): T | undefined => {
    const key = JSON.stringify(q.queryKey)
    const state = client.getQueryState(q.queryKey)
    if (state?.status === 'error') return undefined
    if (!needs.has(key)) needs.set(key, q)
    return client.getQueryData(q.queryKey) as T | undefined
  }
  const failed = (q: Query) => client.getQueryState(q.queryKey)?.status === 'error'
  const open = new Map<string, NavPane>()
  const nodes = build({ get, failed, open })
  const list = [...needs.values()]
  // Subscribes to every read the open lines need, so the tree grows as each arrives.
  useQueries({ queries: list.map((q) => ({ ...q, staleTime: 60_000 })) })
  return { nodes, open, needs: list }
}

interface Walker {
  get: <T>(q: Query) => T | undefined
  failed: (q: Query) => boolean
  open: Map<string, NavPane>
}

/** The lines under an open row: what it links to, then who links to it. */
function rowChildren(w: Walker, id: string, table: string, row: string, ctx: Ctx, opts: { forward: boolean }): { children: TreeNode[]; loading: boolean } {
  const meta = w.get<TableMeta>(metaQuery(table))
  const doc = opts.forward ? w.get<Row>(docQuery(table, row)) : {}
  const cnx = w.get<{ connections: Connection[] }>(connectionsQuery(table, row))
  if (!meta || !doc || !cnx) {
    const gone = w.failed(docQuery(table, row)) || w.failed(connectionsQuery(table, row))
    return { children: [], loading: !gone }
  }
  const children: TreeNode[] = []
  const links = opts.forward ? forwardLinks(meta, doc) : []
  if (links.length) {
    children.push({ id: lineId(id, 'h:to'), label: 'Links to', heading: true })
    for (const link of links) children.push(linkedLine(w, lineId(id, `f:${link.column}`), link.table, link.row_id, ctx))
  }
  const groups = backlinkGroups(cnx.connections)
  if (groups.length) {
    children.push({ id: lineId(id, 'h:from'), label: 'Linked from', heading: true })
    for (const g of groups) children.push(groupLine(w, lineId(id, `g:${g.key}`), g, table, row, ctx))
  }
  return { children, loading: false }
}

interface Ctx { expanded: Set<string>; showAll: Set<string>; onShowAll: (id: string) => void }

/** A row this one links to: named by the title lookup; unreadable, it is a bare line. */
function linkedLine(w: Walker, id: string, table: string, row: string, ctx: Ctx): TreeNode {
  const title = w.get<string | null>(rowTitleQuery(table, row))
  if (title === undefined) return { id, label: '…', kind: table }
  if (title === null) return { id, label: UNSEEN_ROW }
  const meta = w.get<TableMeta>(metaQuery(table))
  return rowLine(w, id, { table, row, label: title, code: meta ? shownCode(meta, row, title) : undefined }, ctx)
}

function rowLine(w: Walker, id: string, root: TreeRoot, ctx: Ctx, opts = { forward: true }): TreeNode {
  w.open.set(id, { table: root.table, row: root.row })
  const node: TreeNode = { id, label: root.label, code: root.code, kind: root.table, hasChildren: true }
  if (!ctx.expanded.has(id)) return node
  const { children, loading } = rowChildren(w, id, root.table, root.row, ctx, opts)
  return { ...node, children, loading, hasChildren: loading || children.length > 0 }
}

function groupLine(w: Walker, id: string, g: BacklinkGroup, table: string, row: string, ctx: Ctx): TreeNode {
  w.open.set(id, { table, row, group: { table: g.connection.table, column: g.connection.column, via: g.connection.via } })
  const node: TreeNode = { id, label: g.label, group: true, count: g.count, hasChildren: g.count > 0 }
  if (!ctx.expanded.has(id) || !g.count) return node
  const meta = w.get<TableMeta>(metaQuery(g.connection.table))
  if (!meta) return { ...node, loading: true, children: [] }
  const all = ctx.showAll.has(id)
  const rows = w.get<{ data: Row[]; total: number }>(groupRowsQuery(g.connection, {
    fields: listFields(viewColumns(meta, {})), limit: all ? ALL_ROWS : TREE_PAGE,
  }))
  if (!rows) return { ...node, loading: true, children: [] }
  const children = rows.data.map((r) => {
    const rowId = String(r.row_id)
    const label = rowDisplayTitle(meta, r, rowId)
    return rowLine(w, lineId(id, `r:${rowId}`), { table: g.connection.table, row: rowId, label, code: shownCode(meta, rowId, label) }, ctx)
  })
  return { ...node, children, more: { shown: rows.data.length, total: rows.total, onShowAll: () => ctx.onShowAll(id) } }
}

/** The ids a row's tree opens with: the row and its groups (depth 2). */
export function defaultExpansion(rootId: string, groups: BacklinkGroup[]): string[] {
  return [rootId, ...groups.map((g) => lineId(rootId, `g:${g.key}`))]
}

/**
 * The tree around one row: "Links to" above it, its groups ("Linked from")
 * below, unfolding in place. Activating a line shows it in the pane.
 */
export function RowRelationTree({ table, row, label, code, expanded, onExpandedChange, onOpen, onFocus, selected }: {
  table: string
  row: string
  label: string
  code?: string
  expanded: Set<string>
  onExpandedChange: (next: Set<string>) => void
  onOpen: (pane: NavPane) => void
  onFocus?: (pane: NavPane) => void
  selected?: string
}) {
  const [showAll, setShowAll] = useState<Set<string>>(new Set())
  const ctx: Ctx = { expanded, showAll, onShowAll: (id) => setShowAll((s) => new Set(s).add(id)) }
  const rootId = 'c'
  const walk = useTreeWalk((w) => {
    const centre = rowLine(w, rootId, { table, row, label, code }, { ...ctx, expanded: new Set([...expanded, rootId]) }, { forward: false })
    const meta = w.get<TableMeta>(metaQuery(table))
    const doc = w.get<Row>(docQuery(table, row))
    const links = meta && doc ? forwardLinks(meta, doc) : []
    const above: TreeNode[] = links.length
      ? [{ id: 'h:to', label: 'Links to', heading: true }, ...links.map((l) => linkedLine(w, lineId('t', `f:${l.column}`), l.table, l.row_id, ctx))]
      : []
    // The row itself always shows its groups: it is the tree's centre.
    return [...above, { ...centre, children: undefined, loading: false, hasChildren: false }, ...(centre.children ?? []), ...(centre.loading ? [{ id: 'loading', label: 'Loading', heading: true }] : [])]
  })
  return <Outline walk={walk} label={`Around ${label}`} expanded={expanded} onExpandedChange={onExpandedChange}
    onOpen={onOpen} onFocus={onFocus} selected={selected} centre={rootId} />
}

/** Every row of a table as a folded top line (the list's tree of all). */
export function TableRelationTree({ roots, label, expanded, onExpandedChange, onOpen, selected, footer }: {
  roots: TreeRoot[]
  label: string
  expanded: Set<string>
  onExpandedChange: (next: Set<string>) => void
  onOpen: (pane: NavPane) => void
  selected?: string
  footer?: ReactNode
}) {
  const [showAll, setShowAll] = useState<Set<string>>(new Set())
  const ctx: Ctx = { expanded, showAll, onShowAll: (id) => setShowAll((s) => new Set(s).add(id)) }
  const walk = useTreeWalk((w) => roots.map((r) => rowLine(w, lineId('a', `${r.table}:${r.row}`), r, ctx)))
  return <>
    <Outline walk={walk} label={label} expanded={expanded} onExpandedChange={onExpandedChange} onOpen={onOpen} selected={selected} />
    {footer}
  </>
}

function Outline({ walk, label, expanded, onExpandedChange, onOpen, onFocus, selected, centre }: {
  walk: Walk
  label: string
  expanded: Set<string>
  onExpandedChange: (next: Set<string>) => void
  onOpen: (pane: NavPane) => void
  onFocus?: (pane: NavPane) => void
  selected?: string
  centre?: string
}) {
  const [picked, setPicked] = useState<string | undefined>(selected)
  return (
    <TreeOutline label={label} nodes={walk.nodes} expanded={expanded} selected={picked ?? selected}
      onToggle={(id) => {
        const next = new Set(expanded)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        onExpandedChange(next)
      }}
      onActivate={(id) => {
        const pane = walk.open.get(id)
        if (!pane) return
        setPicked(id)
        onOpen(pane)
      }}
      renderActions={onFocus ? (node) => {
        const pane = walk.open.get(node.id)
        return pane && !pane.group && node.id === picked && node.id !== centre
          ? <Button variant="secondary" className="min-h-8 px-2 text-xs" onClick={() => onFocus(pane)}>Focus here</Button>
          : null
      } : undefined} />
  )
}

/**
 * #910 checklist 19: a list's Tree of all — every row of the Table (under
 * the list's filters) as a folded line, 20 at a time with Show more.
 */
export function TreeOfAll({ table, filters, expanded, onExpandedChange, onOpen }: {
  table: string
  filters: Filter[]
  expanded: Set<string>
  onExpandedChange: (next: Set<string>) => void
  onOpen: (pane: NavPane) => void
}) {
  const [pages, setPages] = useState(1)
  const meta = useQuery(metaQuery(table)).data
  const fields = meta ? listFields(viewColumns(meta, {})) : []
  const rows = useQuery({ ...groupRowsQuery({ table, filters }, { fields, limit: pages * TREE_PAGE }), enabled: Boolean(meta), placeholderData: keepPreviousData })
  const data = rows.data
  if (!meta || !data) return <p className="text-sm text-ink-subtle">Loading…</p>
  const roots = data.data.map((r) => {
    const rowId = String(r.row_id)
    const label = rowDisplayTitle(meta, r, rowId)
    return { table, row: rowId, label, code: shownCode(meta, rowId, label) }
  })
  return <TableRelationTree roots={roots} label={`Every ${table} row`} expanded={expanded}
    onExpandedChange={onExpandedChange} onOpen={onOpen}
    footer={data.total > roots.length && <div className="mt-3">
      <Button onClick={() => setPages(pages + 1)}>Show more</Button>
    </div>} />
}
