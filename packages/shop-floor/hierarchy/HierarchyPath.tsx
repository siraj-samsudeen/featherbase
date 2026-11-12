// The merchandise hierarchy, said one way everywhere (#1175): division › sub-division › category ›
// subcategory, in that order, with the same separator and the same words for a missing level.
import type { ReactNode } from 'react'
import { cx } from '../src/cx'

export interface HierarchyNode { division: string; subdivision: string; category: string }
export interface HierarchyPathValue extends HierarchyNode { subcategory?: string }

export const HIERARCHY_SEPARATOR = '›'
/** The levels above a subcategory, top first, with what each is called and what an empty one says. */
export const HIERARCHY_LEVELS = [
  { key: 'division', label: 'Division', empty: 'No division' },
  { key: 'subdivision', label: 'Sub-division', empty: 'No sub-division' },
  { key: 'category', label: 'Category', empty: 'No category' },
] as const

/** The path's parts, top first: a missing level says so, the subcategory comes last when there is one. */
export function hierarchyParts(path: HierarchyPathValue): string[] {
  const parts: string[] = HIERARCHY_LEVELS.map(level => path[level.key]?.trim() || level.empty)
  if (path.subcategory) parts.push(path.subcategory)
  return parts
}
/** The path as one line of text, for a title, a sort key or a test. */
export const hierarchyText = (path: HierarchyPathValue) => hierarchyParts(path).join(` ${HIERARCHY_SEPARATOR} `)
const keyOf = (path: HierarchyNode) => JSON.stringify(HIERARCHY_LEVELS.map(level => path[level.key] ?? ''))

/** A path, shown in full. */
export function HierarchyPath({ path, className }: { path: HierarchyPathValue; className?: string }) {
  const parts = hierarchyParts(path)
  return (
    <span className={cx('inline-flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-ink-muted', className)} data-testid="hierarchy-path" title={hierarchyText(path)}>
      {parts.map((part, index) => (
        <span key={index} className="inline-flex items-center gap-x-1.5">
          {index > 0 && <span aria-hidden="true">{HIERARCHY_SEPARATOR}</span>}
          <span className={index === parts.length - 1 && path.subcategory ? 'text-ink' : undefined}>{part}</span>
        </span>
      ))}
    </span>
  )
}

/** Items grouped by their path, groups in path order: one group when they all share one. */
export function groupByPath<T>(items: T[], pathOf: (item: T) => HierarchyNode): { path: HierarchyNode; key: string; items: T[] }[] {
  const groups = new Map<string, { path: HierarchyNode; key: string; items: T[] }>()
  for (const item of items) {
    const path = pathOf(item)
    const key = keyOf(path)
    if (!groups.has(key)) groups.set(key, { path: { division: path.division, subdivision: path.subdivision, category: path.category }, key, items: [] })
    groups.get(key)!.items.push(item)
  }
  return [...groups.values()].sort((a, b) => hierarchyText(a.path).localeCompare(hierarchyText(b.path)))
}

/**
 * A list under its path: shown once above the list when every item shares it, otherwise one
 * heading per path, so two items with the same name are told apart by their group.
 */
export function HierarchyGroups<T>({ items, pathOf, children }: { items: T[]; pathOf: (item: T) => HierarchyNode; children: (items: T[]) => ReactNode }) {
  const groups = groupByPath(items, pathOf)
  if (groups.length <= 1) return (
    <div className="flex flex-col gap-1" data-testid="hierarchy-groups">
      {/* The same heading as a group's, so a path reads the same with one group or many. */}
      {groups[0] && <h3><HierarchyPath path={groups[0].path} className="font-semibold" /></h3>}
      {children(items)}
    </div>
  )
  return (
    <div className="flex flex-col gap-3" data-testid="hierarchy-groups">
      {groups.map(group => (
        <section key={group.key} className="flex flex-col gap-1" aria-label={hierarchyText(group.path)} data-testid="hierarchy-group">
          <h3><HierarchyPath path={group.path} className="font-semibold" /></h3>
          {children(group.items)}
        </section>
      ))}
    </div>
  )
}
