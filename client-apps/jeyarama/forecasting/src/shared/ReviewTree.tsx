// The managers' review table: any chain of levels (levels.ts) down to the subcategories, the same columns at every
// level (MeasureTable with AOP and Value vs AOP), sorted by the heading the reader picked. A node opens
// its children; a subcategory opens its panel (how Feather Forecast built it, other models with AOP, and the page's
// own `answer`); a folded "Smaller subcategories" row opens nothing. When the subcategories shown under a node are one
// store's, they form groups (TL-20) the way the Team Leader's table does, in the Groups view picked.
import { useMemo, type ReactNode } from 'react'
import { Chip, RecordLink } from '@featherbase/shop-floor'
import { combine, groupsOf, inr, isFolded, storeStepOf, type Group, type HelpTopic, type Line } from './model'
import { headingOf, treeOf, type Level, type TreeNode } from './levels'
import { MeasureTable, SORTERS, type SortKey, type TableRow } from './MeasureTable'
import { LinePanel } from './LinePanel'
import { Hover } from './Hover'
import type { Header } from './review'
import type { ViewChoices } from './ReviewToolbar'

export const LINE_TABLE = 'forecasting.forecast_line_month'

export interface ReviewTreeProps {
  header: Header; view: ViewChoices; lines: Line[]; levels: Level[]
  /** The total row's label ("Store", "Both regions", "In scope"). */
  totalLabel: string
  /** The first column's heading; by default the levels' names joined, ending in Subcategory. */
  firstHeading?: string
  sort: SortKey; onSort: (k: SortKey) => void
  /** Open tree nodes, by id ("Kerala › LKS"); `onToggleNode` opens or closes one. */
  openNodes: Set<string>; onToggleNode: (id: string) => void
  /** The open subcategory (its rowId) or group (group:<store>:<index>), and how the page changes it. */
  open: string | null; onOpen: (key: string | null) => void
  /** Where a subcategory opens on its own (its RecordLink). */
  hrefFor: (l: Line) => string
  /** What an opened subcategory shows under the other models: the page's change form, a proposal, questions. */
  answer?: (l: Line) => ReactNode
  linePills?: (l: Line) => ReactNode
  nodePills?: (n: TreeNode) => ReactNode
  /** The muted line under a node (a section's Team Leader and progress); the level's own subLabel otherwise. */
  nodeSub?: (n: TreeNode) => ReactNode
  /** A leaf named by something else than its subcategory (Subcategory › Store names it by its store). */
  leafLabel?: (l: Line) => ReactNode
  onHelp?: (topic: HelpTopic, from: string) => void
  flash?: { key: string; n: number } | null
  /** The fold's limit, for a folded row's words ("4 under ₹50,000 each"): RB's page folds with foldSmall. */
  smallUnder?: number
  /** Drill one level at a time: clicking a node calls this instead of opening it in place. */
  onDrill?: (n: TreeNode) => void
  /** A subcategory's click calls this instead of opening its panel in place (RB opens it in the side pane). */
  onLine?: (l: Line) => void
  /** False: no groups at all, not even the G1 tags (RB's one-level table). */
  groups?: boolean
  valueOnly?: (item: Line | Group) => boolean
  rowEnd?: (row: TableRow) => ReactNode
}

const pillsOf = (x: ReactNode) => (Array.isArray(x) ? (x.length ? x : undefined) : x || undefined)
const groupKey = (g: Group) => `group:${g.store}:${g.category}:${g.index}`

export function ReviewTree(p: ReviewTreeProps) {
  const { header, view, lines, levels, sort, openNodes, open } = p
  const order = SORTERS[sort]
  const tree = useMemo(() => treeOf(lines, levels, 0, '', (a, b) => order(a.item, b.item)), [lines, levels, order])
  const total = useMemo(() => combine(lines, -1, p.totalLabel), [lines, p.totalLabel])
  const steps = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of new Set(lines.map(l => l.store))) m.set(s, storeStepOf(lines.filter(l => l.store === s)))
    return m
  }, [lines])

  const leafRow = (l: Line, depth: number, look: TableRow['look'] = [], tag?: ReactNode): TableRow => isFolded(l)
    ? { key: l.rowId, item: l, depth, opens: false, label: <b>{l.name}</b>, sub: `${l.n} under ${inr(p.smallUnder ?? 0)} each · ${l.category}` }
    : {
      key: l.rowId, dataName: l.name, item: l, depth, look, ...(p.onLine ? { onClick: () => p.onLine!(l) } : {}),
      label: <>{tag}{p.leafLabel ? p.leafLabel(l) : <RecordLink table={LINE_TABLE} rowId={l.rowId} name={l.name} href={p.hrefFor(l)} onNavigate={() => {}} />}</>,
      // the pills go on the line under the name, as the prototypes draw them, so a deep name keeps its room
      sub: pillsOf(p.linePills?.(l)),
    }
  const groupRow = (g: Group, depth: number, look: TableRow['look']): TableRow => ({
    key: groupKey(g), dataName: g.name, item: g, depth, look,
    label: <><Chip hue="violet" compact>Group {g.index + 1}</Chip><b>{g.name}</b></>,
    sub: `${g.members.length} subcategories moved in opposite directions`,
  })

  /** A node's subcategories, with the groups of one store's lines in the Groups view picked. */
  const leaves = (ls: Line[], depth: number): TableRow[] => {
    const sorted = [...ls].sort(order)
    const oneStore = p.groups !== false && !p.leafLabel && new Set(ls.map(l => l.store)).size === 1
    const groups = oneStore ? groupsOf(ls.filter(l => !isFolded(l))) : []
    const groupOf = (l: Line) => groups.find(g => g.members.some(m => m.rowId === l.rowId))
    const rows: TableRow[] = []
    if (!groups.length || view.groups === 'off') {
      for (const l of sorted) {
        const g = groupOf(l)
        rows.push(leafRow(l, depth, [], g && <Hover text={`In group ${g.index + 1}: ${g.members.map(m => m.name).join(', ')}`}><Chip hue="violet" compact>G{g.index + 1}</Chip></Hover>))
      }
      return rows
    }
    const loose = sorted.filter(l => !groupOf(l))
    if (view.groups === 'band') {
      for (const g of groups) { rows.push(groupRow(g, depth, ['band', 'head'])); g.members.forEach(m => rows.push(leafRow(m, depth + 1, ['band']))) }
      loose.forEach(l => rows.push(leafRow(l, depth)))
      return rows
    }
    for (const it of [...groups, ...loose].sort(order)) {
      if (!('members' in it)) { rows.push(leafRow(it, depth)); continue }
      rows.push(groupRow(it, depth, ['band']))
      if (open === groupKey(it) || it.members.some(m => m.rowId === open)) it.members.forEach(m => rows.push(leafRow(m, depth + 1, ['band'])))
    }
    return rows
  }

  const rows: TableRow[] = []
  // each row's parent (the node above it, or the total at the top) gives its Share: siblings add up to 100%
  const under = (rs: TableRow[], parent: Line | Group) => rs.map(r => ({ ...r, parent }))
  const walk = (nodes: TreeNode[], parent: Group) => {
    for (const n of nodes) {
      const expanded = openNodes.has(n.id)
      rows.push({
        key: `node:${n.id}`, dataName: n.label, item: n.item, depth: n.depth, expanded, parent,
        onClick: p.onDrill ? () => p.onDrill!(n) : () => p.onToggleNode(n.id),
        label: <b>{n.label}{n.detail && <> <span className="fr-detail">{n.detail}</span></>}</b>,
        sub: (p.nodePills || p.nodeSub || n.subLabel) && <>{p.nodePills?.(n)}{p.nodeSub?.(n) ?? n.subLabel}</>,
      })
      if (!expanded || p.onDrill) continue
      if (n.children.length) walk(n.children, n.item)
      else rows.push(...under(leaves(n.lines, n.depth + 1), n.item))
    }
  }
  if (levels.length) walk(tree, total); else rows.push(...under(leaves(lines, 0), total))

  const panel = (row: TableRow, width: number | undefined) => {
    const l = row.item
    const own = 'members' in l ? null : (l as Line)
    return (
      <LinePanel item={l} header={header} storeStep={steps.get(l.store) ?? 1} aop width={width}
        onHelp={topic => p.onHelp?.(topic, row.key)} answer={own && p.answer?.(own)} />
    )
  }
  return (
    <MeasureTable header={header} view={view} rows={rows} total={total} totalLabel={p.totalLabel} firstHeading={p.firstHeading ?? headingOf(levels)}
      open={open} onToggle={p.onOpen} panel={panel} flash={p.flash} vsAop sort={sort} onSort={p.onSort} valueOnly={p.valueOnly} rowEnd={p.rowEnd} share />
  )
}
