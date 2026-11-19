// #1289 option C, Click To Narrow (the QlikView model): a panel beside every
// list with one list of values per table the list's rows reach, each value with
// a live count. A tick is never a filter of its own kind: it is the #1276
// Linked to filter (or, for the list's own rows and its Choice columns, the
// plain `in` / `is blank` filter), so the address, saved views and the filter
// chips keep working, and there is one filter model, not two.
import { MAX_RELATED_DEPTH } from 'shared'
import type { Backlink } from './connections'
import { chainFilter, linkKey, parseChain, type ChainStep, type Filter, type Link } from './linked-filters'
import { dataColumns, isLinkTable, readableLinks } from './list-view-columns'
import { linkRowsTable, tableLabel, type TableMeta } from './meta'

/** One step of a list's path, as the server's :narrow reads it: forward along
 *  a link, or back from the rows of `from` linking here. */
export type NarrowStep = { column: string } | { from: string; column: string }

export interface NarrowList {
  key: string
  /** The list's heading: its table's name only (or its Choice column's). */
  label: string
  /** For a list more than one link away, the table it is reached through. */
  through?: string
  kind: 'link' | 'rows' | 'choice'
  /** Whose rows the values are (link and rows lists). */
  table?: string
  /** The Choice column (choice lists). */
  column?: string
  /** A link list's chain, as the Linked to filter spells it. */
  steps?: Pick<ChainStep, 'table' | 'link'>[]
  path: NarrowStep[]
}

/** What a list has picked: values, "not linked to any", or nothing. */
export type Picked = string[] | 'none' | null

/** A Table's metadata: `undefined` while it loads, `null` when the viewer may not read it. */
export type MetaOf = (table: string) => TableMeta | null | undefined

/** The most lists one panel shows (the server counts at most 40 per request). */
export const MAX_NARROW_LISTS = 24

interface Walk { meta: TableMeta; steps: NonNullable<NarrowList['steps']>; path: NarrowStep[]; through?: string; depth: number }

/**
 * The panel's lists for a list of `meta`'s rows, in this order: every table its
 * links reach (nearest first, each table once, up to MAX_RELATED_DEPTH links),
 * its own rows (not for a link table, whose rows read by what they link), the
 * far side of each link table pointing here and what that links to, then its
 * Choice columns. `missing` names the tables whose metadata is still needed.
 */
export function narrowLists(meta: TableMeta, backlinks: Backlink[], metaOf: MetaOf): { lists: NarrowList[]; missing: string[] } {
  const missing = new Set<string>()
  // A connected Table's rows are counted by its source, which :narrow does not reach.
  if (meta.data_source) return { lists: [], missing: [] }
  const label = (t: string) => tableLabel(t, metaOf(t) ?? undefined)
  const seen = new Set<string>([meta.name])
  const usable = (t: string | null | undefined): t is string => {
    if (!t) return false
    const m = metaOf(t)
    if (m === undefined) missing.add(t)
    return Boolean(m && !m.data_source)
  }
  const links = (m: TableMeta) => readableLinks(m).filter((c) => !c.table_column)
  const lists: NarrowList[] = []
  const linkList = (w: Walk, table: string): NarrowList => ({
    key: `link:${w.path.map((s) => ('from' in s ? `${s.from}<${s.column}` : s.column)).join('>')}`,
    label: label(table), kind: 'link', table, steps: w.steps, path: w.path,
    ...(w.through ? { through: w.through } : {}),
  })
  // Breadth first, so a table is listed by its shortest path.
  const walkForward = (start: Walk[]) => {
    let frontier = start
    while (frontier.length) {
      const next: Walk[] = []
      for (const w of frontier) {
        if (w.depth >= MAX_RELATED_DEPTH) continue
        for (const c of links(w.meta)) {
          const t = linkRowsTable(c)
          if (!usable(t) || seen.has(t)) continue
          seen.add(t)
          const step: Walk = {
            meta: metaOf(t)!, depth: w.depth + 1,
            steps: [...w.steps, { table: t, link: { kind: 'forward', column: c.column_name } }],
            path: [...w.path, { column: c.column_name }],
            through: w.through ?? (w.steps.length ? label(w.steps[0].table) : undefined),
          }
          lists.push(linkList(step, t))
          next.push(step)
        }
      }
      frontier = next
    }
  }
  walkForward([{ meta, steps: [], path: [], depth: 0 }])
  byBranch(lists, 0)
  if (!isLinkTable(meta)) lists.push({ key: 'rows', label: label(meta.name), kind: 'rows', table: meta.name, path: [] })
  // The far side of each link table pointing here (Section → Section
  // Subcategory → Subcategory), two links deep, and what it links on to.
  const farSides: Walk[] = []
  for (const b of backlinks.filter((x) => !x.via)) {
    const linkMeta = metaOf(b.table)
    if (linkMeta === undefined) missing.add(b.table)
    if (!linkMeta || linkMeta.data_source || !isLinkTable(linkMeta)) continue
    for (const far of links(linkMeta)) {
      const t = linkRowsTable(far)
      if (far.column_name === b.column || !usable(t) || seen.has(t)) continue
      seen.add(t)
      const link: Link = { kind: 'through', link: b.table, back: b.column, column: far.column_name }
      const w: Walk = {
        meta: metaOf(t)!, depth: 2, through: label(b.table),
        steps: [{ table: t, link }], path: [{ from: b.table, column: b.column }, { column: far.column_name }],
      }
      lists.push(linkList(w, t))
      farSides.push(w)
    }
  }
  const farFrom = lists.length
  walkForward(farSides)
  byBranch(lists, farFrom - farSides.length)
  for (const c of dataColumns(meta).filter((x) => x.column_type === 'Choice'))
    lists.push({ key: `choice:${c.column_name}`, label: c.label ?? c.column_name, kind: 'choice', column: c.column_name, path: [{ column: c.column_name }] })
  return { lists: lists.slice(0, MAX_NARROW_LISTS), missing: [...missing] }
}

/** Board A's order, from `from` on: lists grouped by the link they start from,
 *  in the order those links come, each group's farthest table first (Store,
 *  Floor, then Section; Division, Category, then Subcategory). Found breadth
 *  first, so each table is still listed by its shortest path. */
function byBranch(lists: NarrowList[], from: number) {
  const branchOf = (l: NarrowList) => { const s = l.path[0]; return s ? ('from' in s ? `${s.from}<${s.column}` : s.column) : '' }
  const part = lists.slice(from)
  const order = [...new Set(part.map(branchOf))]
  part.sort((a, b) => order.indexOf(branchOf(a)) - order.indexOf(branchOf(b)) || b.path.length - a.path.length)
  lists.splice(from, part.length, ...part)
}

/** The one filter a list's picks add to the list, or none when nothing is picked. */
export function pickFilter(list: NarrowList, picked: Picked): Filter | null {
  if (!picked || (picked !== 'none' && !picked.length)) return null
  if (list.kind === 'choice') return picked === 'none' ? [list.column!, 'is blank', null] : [list.column!, 'in', picked]
  if (list.kind === 'rows') return picked === 'none' ? null : ['row_id', 'in', picked]
  const steps = list.steps!
  return chainFilter(
    steps.map((s, i) => ({ ...s, picked: picked !== 'none' && i === steps.length - 1 ? picked : [] })),
    picked === 'none',
  )
}

/** What a filter picks in this list, or null when the filter is not this list's. */
export function readPick(list: NarrowList, filter: Filter): Picked {
  const [field, op, value] = filter
  if (list.kind === 'choice') {
    if (field !== list.column) return null
    if (op === 'is blank') return 'none'
    return op === 'in' && Array.isArray(value) && value.length && value.every((v) => typeof v === 'string') ? value as string[] : null
  }
  if (list.kind === 'rows')
    return field === 'row_id' && op === 'in' && Array.isArray(value) && value.length && value.every((v) => typeof v === 'string') ? value as string[] : null
  const chain = parseChain(filter)
  const steps = list.steps!
  if (!chain || chain.steps.length !== steps.length) return null
  if (!chain.steps.every((s, i) => s.table === steps[i].table && linkKey(s.table, s.link) === linkKey(steps[i].table, steps[i].link) && !s.search))
    return null
  const last = chain.steps.length - 1
  if (!chain.steps.every((s, i) => i === last || !s.picked.length)) return null
  if (chain.negate) return chain.steps[last].picked.length ? null : 'none'
  return chain.steps[last].picked.length ? chain.steps[last].picked : null
}

/** The panel's picks, list by list, and the list's other filters. A filter
 *  belongs to the first list it reads as; a second one for a list stays a filter. */
export function splitPicks(lists: NarrowList[], filters: Filter[]): { base: Filter[]; picks: Picked[]; owner: (number | null)[] } {
  const picks: Picked[] = lists.map(() => null)
  const owner = filters.map((f) => {
    const i = lists.findIndex((l, j) => picks[j] === null && readPick(l, f) !== null)
    if (i < 0) return null
    picks[i] = readPick(lists[i], f)
    return i
  })
  return { base: filters.filter((_, k) => owner[k] === null), picks, owner }
}

/** The list's filters with list `i`'s picks replaced: its filter stays where it was. */
export function setPick(lists: NarrowList[], filters: Filter[], i: number, picked: Picked): Filter[] {
  const { owner } = splitPicks(lists, filters)
  const next = pickFilter(lists[i], picked)
  const at = owner.indexOf(i)
  if (at < 0) return next ? [...filters, next] : filters
  return next ? filters.map((f, k) => (k === at ? next : f)) : filters.filter((_, k) => k !== at)
}

/** A tick on a value (`null` is "Not linked to any"): it adds or removes the
 *  value. "Not linked" replaces the list's other picks, and a value replaces it. */
export function togglePick(lists: NarrowList[], filters: Filter[], i: number, value: string | null): Filter[] {
  const cur = splitPicks(lists, filters).picks[i]
  const next: Picked = value === null ? (cur === 'none' ? null : 'none')
    : !cur || cur === 'none' ? [value]
    : cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
  return setPick(lists, filters, i, next)
}
