// A hierarchy over subcategories, for the review pages that show more than one level (the Store Manager's
// floor › section › subcategory or division › … › subcategory; the category head's category › store). A page
// names its levels top down; the subcategories are always the leaves. Each node sums its subcategories
// (combine), so every level reads the same figures and parts as a subcategory.
import { combine, type Group, type Line } from './model'

/** One level of a hierarchy: what it is called, which value of a subcategory puts it in a node, and optionally
 *  how its nodes are ordered and a small line under each node's name. */
export interface Level {
  name: string
  key: (l: Line) => string
  /** Nodes of this level, in order; by default largest Feather Forecast first. */
  sort?: (a: TreeNode, b: TreeNode) => number
  subLabel?: (n: TreeNode) => string | undefined
}
export interface TreeNode {
  /** The path to it, "Ground floor › Girls Bottoms", unique in the tree. */
  id: string
  level: string; label: string; subLabel?: string; depth: number
  item: Group; children: TreeNode[]
  /** Its subcategories, in the tree's order. */
  lines: Line[]
}

const byForecast = (a: TreeNode, b: TreeNode) => b.item.fc - a.item.fc

/** The nodes of `levels` over `lines`, top level first; a subcategory is a leaf under the last level. */
export function treeOf(lines: Line[], levels: Level[], depth = 0, path = ''): TreeNode[] {
  const [level, ...rest] = levels
  if (!level) return []
  const keys = [...new Set(lines.map(level.key))]
  const nodes = keys.map((label): TreeNode => {
    const mine = lines.filter(l => level.key(l) === label)
    const id = path ? `${path} › ${label}` : label
    const node: TreeNode = { id, level: level.name, label, depth, item: combine(mine, -1, label), children: treeOf(mine, rest, depth + 1, id), lines: mine }
    node.subLabel = level.subLabel?.(node)
    return node
  })
  return nodes.sort(level.sort ?? byForecast)
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
