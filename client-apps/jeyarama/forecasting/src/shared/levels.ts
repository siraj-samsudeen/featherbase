// A hierarchy over subcategories, for the review pages that show more than one level (the Store Manager's
// floor › section › subcategory or division › … › subcategory; the category head's category › store). A page
// names its levels top down; the subcategories are always the leaves. Each node sums its subcategories
// (combine), so every level reads the same figures and parts as a subcategory.
import { combine, type Group, type Line } from './model'

/** Pieces of different categories do not add up (RB, 28-Nov): a figure spanning more than one category (a region, a
 *  store, a floor, a division) shows value only; within one category quantity shows. */
export const multiCategory = (lines: Line[]) => new Set(lines.map(l => l.category)).size > 1
export const valueOnly = (item: Line | Group) => 'members' in item && multiCategory(item.members)

/** One level of a hierarchy: what it is called, which value of a subcategory puts it in a node, and optionally
 *  how its nodes are ordered and a small line under each node's name. */
export interface Level {
  name: string
  key: (l: Line) => string
  /** Nodes of this level, in order; by default largest Feather Forecast first. */
  sort?: (a: TreeNode, b: TreeNode) => number
  subLabel?: (n: TreeNode) => string | undefined
  /** A dim word after the node's name (a store's name after its code: "LKS Lakeside"). */
  detail?: (n: TreeNode) => string | undefined
}
export interface TreeNode {
  /** The path to it, "Ground floor › Girls Bottoms", unique in the tree. */
  id: string
  level: string; label: string; subLabel?: string; detail?: string; depth: number
  item: Group; children: TreeNode[]
  /** Its subcategories, in the tree's order. */
  lines: Line[]
}

const byForecast = (a: TreeNode, b: TreeNode) => b.item.fc - a.item.fc

/** The nodes of `levels` over `lines`, top level first; a subcategory is a leaf under the last level. */
export function treeOf(lines: Line[], levels: Level[], depth = 0, path = '', order: (a: TreeNode, b: TreeNode) => number = byForecast): TreeNode[] {
  const [level, ...rest] = levels
  if (!level) return []
  const keys = [...new Set(lines.map(level.key))]
  const nodes = keys.map((label): TreeNode => {
    const mine = lines.filter(l => level.key(l) === label)
    const id = path ? `${path} › ${label}` : label
    const node: TreeNode = { id, level: level.name, label, depth, item: combine(mine, -1, label), children: treeOf(mine, rest, depth + 1, id, order), lines: mine }
    node.subLabel = level.subLabel?.(node)
    node.detail = level.detail?.(node)
    return node
  })
  return nodes.sort(level.sort ?? order)
}

export type Visible = { node: TreeNode; line?: undefined } | { node?: undefined; line: Line; depth: number }
/** The rows a reader sees: every top node, the children of each open node, and an open last level's subcategories
 *  (by `order`, default largest Feather Forecast first). */
export function visibleRows(nodes: TreeNode[], openIds: Set<string>, order: (a: Line, b: Line) => number = (a, b) => b.fc - a.fc): Visible[] {
  return nodes.flatMap((node): Visible[] => {
    if (!openIds.has(node.id)) return [{ node }]
    const below = node.children.length ? visibleRows(node.children, openIds, order)
      : [...node.lines].sort(order).map(line => ({ line, depth: node.depth + 1 }))
    return [{ node }, ...below]
  })
}

/** The node ids from the top down to a subcategory, for opening the tree at it (a jump, a search, Approvals). */
export const pathTo = (l: Line, levels: Level[]) => levels.map(lv => lv.key(l)).map((_, i, keys) => keys.slice(0, i + 1).join(' › '))

// ---- the levels the managers' pages use ---------------------------------------------------------------
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** The levels by name. A page composes its views from these; the subcategories are always the leaves. */
export const LEVEL = {
  region: { name: 'Region', key: l => l.region } as Level,
  store: { name: 'Store', key: l => l.store, detail: n => n.lines[0]?.storeName } as Level,
  /** Floors in building order (Ground, First, …), not by size. */
  floor: { name: 'Floor', key: l => l.floor || 'Not placed on a floor', sort: (a, b) => a.lines[0].floorOrder - b.lines[0].floorOrder,
    subLabel: n => `${plural(new Set(n.lines.map(l => l.section)).size, 'section', 'sections')} · ${plural(n.lines.length, 'subcategory', 'subcategories')}` } as Level,
  section: { name: 'Section', key: l => l.section } as Level,
  division: { name: 'Division', key: l => l.division } as Level,
  subdivision: { name: 'Subdivision', key: l => l.subdivision } as Level,
  category: { name: 'Category', key: l => l.category } as Level,
  subcategory: { name: 'Subcategory', key: l => l.name } as Level,
} satisfies Record<string, Level>

/** A store as it is laid out: floor › section › subcategory. */
export const STORE_LAYOUT: Level[] = [LEVEL.floor, LEVEL.section]
/** As it is bought: division › subdivision › category › subcategory. */
export const MERCHANDISE: Level[] = [LEVEL.division, LEVEL.subdivision, LEVEL.category]
/** The heading of a tree's first column: "Floor › Section › Subcategory". */
export const headingOf = (levels: Level[], leaf = 'Subcategory') => [...levels.map(l => l.name), leaf].join(' › ')
