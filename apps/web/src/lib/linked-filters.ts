// #1276 (relational navigation, slice 5): "Linked to…" and "Not linked to…" on
// a list's Add filter. A filter is one 'related' (or 'not related') list filter
// the server compiles to permission-scoped subqueries, so a row the viewer may
// not read never matches. A chain ("Sections linked to Subcategories linked to
// the Sarees division") nests one step inside the one before, exactly as
// Explore's panes did; Explore is retired and its addresses translate here.
import { MAX_RELATED_DEPTH } from 'shared'
import type { Backlink } from './connections'
import { dataColumns, isLinkTable, readableLinks } from './list-view-columns'
import { linkRowsTable, tableLabel, type TableMeta } from './meta'

export type Filter = [string, string, unknown]

/** How a row of one Table is linked to rows of another. */
export type Link =
  /** This Table's Reference column points at the other Table. */
  | { kind: 'forward'; column: string }
  /** The other Table's Reference column points here; `parent` when the other
   *  Table holds this Table's sub-table rows. */
  | { kind: 'back'; column: string }
  /** This Table holds sub-table rows (`via`) whose column points at the other Table. */
  | { kind: 'via'; via: string; column: string }
  /** A row of a link Table (`link`) points here by `back` and at the other Table by `column`. */
  | { kind: 'through'; link: string; back: string; column: string }

/** One Table a list can be linked to, as Add filter offers it. */
export interface LinkOption {
  key: string
  /** The Table whose rows are picked. */
  table: string
  label: string
  link: Link
}

export function linkKey(table: string, link: Link): string {
  switch (link.kind) {
    case 'forward':
    case 'back':
      return `${link.kind}:${table}:${link.column}`
    case 'via':
      return `via:${table}:${link.via}:${link.column}`
    case 'through':
      return `through:${table}:${link.link}:${link.back}:${link.column}`
  }
}

/** How many nested related levels a step uses: a link table is two hops. */
export const linkDepth = (link: Link) => (link.kind === 'through' ? 2 : 1)

/**
 * Every Table a row of `meta` can be linked to: its links (forward), the
 * Tables linking to it (back), the far side of each link Table pointing at it
 * (through), the Tables its own sub-table rows point at (via), its own
 * sub-tables, and the Tables holding sub-table rows that point at it. A Table
 * on a Data Source offers only its links within that source, which is all its
 * server can follow.
 */
export function linkOptions(
  meta: TableMeta,
  backlinks: Backlink[],
  metaOf: (table: string) => TableMeta | undefined,
): LinkOption[] {
  const label = (t: string) => tableLabel(t, metaOf(t))
  const options: LinkOption[] = []
  const add = (table: string, text: string, link: Link) => {
    const key = linkKey(table, link)
    if (!options.some((o) => o.key === key)) options.push({ key, table, label: text, link })
  }
  const refs = dataColumns(meta).filter((c) => c.column_type === 'Reference' && linkRowsTable(c))
  for (const c of refs) {
    const target = linkRowsTable(c)!
    if (meta.data_source && metaOf(target)?.data_source !== meta.data_source) continue
    // Two links into one Table are told apart by their column.
    const twice = refs.filter((r) => linkRowsTable(r) === target).length > 1
    add(target, twice ? `${label(target)} · ${c.label ?? c.column_name}` : label(target), { kind: 'forward', column: c.column_name })
  }
  if (meta.data_source) return options
  const direct = backlinks.filter((b) => !b.via)
  for (const b of direct) {
    const twice = direct.filter((x) => x.table === b.table).length > 1
    const by = metaOf(b.table)?.columns.find((c) => c.column_name === b.column)
    add(b.table, twice ? `${label(b.table)} · ${by?.label ?? b.column}` : label(b.table), { kind: 'back', column: b.column })
    const linkMeta = metaOf(b.table)
    if (!linkMeta || !isLinkTable(linkMeta)) continue
    for (const far of readableLinks(linkMeta)) {
      if (far.column_name === b.column) continue
      const target = linkRowsTable(far)!
      add(target, `${label(target)} · through ${label(b.table)}`, { kind: 'through', link: b.table, back: b.column, column: far.column_name })
    }
  }
  for (const b of backlinks.filter((x) => x.via))
    add(b.table, `${label(b.table)} · via ${label(b.via!)}`, { kind: 'through', link: b.via!, back: b.column, column: 'parent' })
  for (const grid of meta.columns.filter((c) => c.column_type === 'Sub-table' && c.row_table)) {
    const rows = grid.row_table!
    add(rows, `${label(rows)} · rows of this ${label(meta.name)}`, { kind: 'back', column: 'parent' })
    for (const c of readableLinks(metaOf(rows) ?? ({ columns: [] } as unknown as TableMeta)))
      add(linkRowsTable(c)!, `${label(linkRowsTable(c)!)} · via ${label(rows)}`, { kind: 'via', via: rows, column: c.column_name })
  }
  // A Table linked both ways (an employee's manager is an employee) names its
  // column on each: "Employee · Manager" and "Employee · by their Manager".
  return options.map((o) => {
    if (options.filter((x) => x.label === o.label).length < 2 || (o.link.kind !== 'forward' && o.link.kind !== 'back')) return o
    const by = o.link.kind === 'forward' ? meta : metaOf(o.table)
    const name = by?.columns.find((c) => c.column_name === o.link.column)?.label ?? o.link.column
    return { ...o, label: o.link.kind === 'forward' ? `${o.label} · ${name}` : `${o.label} · by their ${name}` }
  })
}

/** The one list filter that links a row to rows of `table` matching `inner`. */
export function linkFilter(link: Link, table: string, inner: Filter[], negate = false): Filter {
  const op = negate ? 'not related' : 'related'
  switch (link.kind) {
    case 'forward':
      return [link.column, op, { table, filters: inner }]
    case 'back':
      return ['row_id', op, { table, column: link.column, filters: inner }]
    case 'via':
      return ['row_id', op, { via: link.via, column: link.column, table, filters: inner }]
    case 'through':
      return ['row_id', op, { table: link.link, column: link.back, filters: [[link.column, 'related', { table, filters: inner }]] }]
  }
}

/** One step of a chain: the Table it goes to, how, and the rows picked there
 *  (none picked means any row the next step allows). */
export interface ChainStep {
  table: string
  link: Link
  picked: string[]
}

/** The filters a step's own Table is narrowed by: its picked rows and the next step. */
export function stepFilters(steps: ChainStep[], at: number): Filter[] {
  const step = steps[at]
  const next = steps[at + 1]
  return [
    ...(step.picked.length ? [['row_id', 'in', step.picked] as Filter] : []),
    ...(next ? [linkFilter(next.link, next.table, stepFilters(steps, at + 1))] : []),
  ]
}

/** A chain as the one filter the list sends. */
export function chainFilter(steps: ChainStep[], negate = false): Filter {
  return linkFilter(steps[0].link, steps[0].table, stepFilters(steps, 0), negate)
}

/** How many related levels a chain uses; the server takes MAX_RELATED_DEPTH. */
export const chainDepth = (steps: Pick<ChainStep, 'link'>[]) => steps.reduce((n, s) => n + linkDepth(s.link), 0)
export const fitsDepth = (steps: Pick<ChainStep, 'link'>[]) => chainDepth(steps) <= MAX_RELATED_DEPTH

type Spec = { table?: unknown; via?: unknown; column?: unknown; parentfield?: unknown; filters?: unknown }
const isSpec = (v: unknown): v is Spec => !!v && typeof v === 'object' && !Array.isArray(v)
const isFilter = (f: unknown): f is Filter => Array.isArray(f) && f.length === 3 && typeof f[0] === 'string' && typeof f[1] === 'string'

/** A filter read back as the chain it was built from, or none when it is not one
 *  (a hand-written relationship filter reads as it is written). */
export function parseChain(filter: Filter): { negate: boolean; steps: ChainStep[] } | null {
  const [field, op, value] = filter
  if (op !== 'related' && op !== 'not related') return null
  const steps = readStep(field, value)
  return steps ? { negate: op === 'not related', steps } : null
}

function readStep(field: string, value: unknown): ChainStep[] | null {
  if (!isSpec(value) || typeof value.table !== 'string' || value.parentfield !== undefined) return null
  const inner = value.filters ?? []
  if (!Array.isArray(inner) || !inner.every(isFilter)) return null
  let link: Link
  let table = value.table
  let rest: Filter[] = inner
  if (typeof value.via === 'string' && typeof value.column === 'string') {
    if (field !== 'row_id') return null
    link = { kind: 'via', via: value.via, column: value.column }
  } else if (value.via !== undefined) return null
  else if (typeof value.column === 'string') {
    if (field !== 'row_id') return null
    const [only] = inner
    const far = inner.length === 1 && only[1] === 'related' && only[0] !== 'row_id' && isSpec(only[2]) &&
      only[2].column === undefined && only[2].via === undefined && typeof only[2].table === 'string' ? only[2] : null
    if (far) {
      link = { kind: 'through', link: value.table, back: value.column, column: only[0] }
      table = far.table as string
      const farInner = far.filters ?? []
      if (!Array.isArray(farInner) || !farInner.every(isFilter)) return null
      rest = farInner
    } else link = { kind: 'back', column: value.column }
  } else {
    if (value.column !== undefined) return null
    link = { kind: 'forward', column: field }
  }
  let picked: string[] = []
  let next: ChainStep[] = []
  for (const f of rest) {
    if (f[0] === 'row_id' && f[1] === 'in' && Array.isArray(f[2]) && f[2].every((n) => typeof n === 'string') && !picked.length) {
      picked = f[2] as string[]
      continue
    }
    if (f[1] === 'related' && !next.length) {
      const deeper = readStep(f[0], f[2])
      if (!deeper) return null
      next = deeper
      continue
    }
    return null
  }
  return [{ table, link, picked }, ...next]
}

// ---------- counts ----------

/** The grouped count that says, for each row of `step.table`, how many rows of
 *  `from` (matching `fromFilters`) are linked to it. Every read is the
 *  server's permission-scoped list read, so an unreadable row is never counted.
 *  Through a sub-table it counts lines, not distinct rows. */
export function choiceCountQuery(from: string, fromFilters: Filter[], step: Pick<ChainStep, 'table' | 'link'>): { table: string; group_by: string; filters: Filter[] } {
  const all = { table: from, filters: fromFilters }
  const { link } = step
  switch (link.kind) {
    case 'forward':
      return { table: from, group_by: link.column, filters: fromFilters }
    case 'back':
      return { table: step.table, group_by: 'row_id', filters: [[link.column, 'related', all]] }
    case 'via':
      return { table: link.via, group_by: link.column, filters: [['parenttype', '=', from], ['parent', 'related', all]] }
    case 'through':
      return { table: link.link, group_by: link.column, filters: [[link.back, 'related', all]] }
  }
}

// ---------- old Explore addresses ----------

/** One step of a retired Explore chain, as its `chain=` address spelled it. */
export interface ExploreStep {
  mode: 'backlink' | 'child' | 'viabacklink'
  table: string
  column: string
  via?: string
}

function isExploreStep(value: unknown): value is ExploreStep {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  if (s.mode !== 'backlink' && s.mode !== 'child' && s.mode !== 'viabacklink') return false
  if (typeof s.table !== 'string' || typeof s.column !== 'string') return false
  if (s.mode === 'viabacklink') return typeof s.via === 'string'
  return s.via === undefined
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * B3: an Explore address as the list it showed last, filtered by the chain
 * that led there: the last pane's Table, linked to the pane before it, linked
 * to the first pane's picked rows. An address is user input: what does not
 * read as a chain is dropped from the first step that fails.
 */
export function exploreToList(search: { root?: string; chain?: string; select?: string }): { table: string; filters: Filter[] } | null {
  if (!search.root) return null
  const rawChain = parseJson(search.chain)
  const chain: ExploreStep[] = []
  for (const s of Array.isArray(rawChain) ? rawChain.slice(0, 2) : []) {
    if (!isExploreStep(s)) break
    chain.push(s)
  }
  const rawSelect = parseJson(search.select)
  const select = Array.isArray(rawSelect) && rawSelect.every((n) => typeof n === 'string') ? (rawSelect as string[]) : []
  let filters: Filter[] = select.length ? [['row_id', 'in', select]] : []
  let upstream = search.root
  for (const step of chain) {
    const spec = { table: upstream, filters }
    filters = [
      step.mode === 'child' ? ['parent', 'related', spec]
        : step.mode === 'viabacklink' ? ['row_id', 'related', { via: step.via, column: step.column, ...spec }]
        : [step.column, 'related', spec],
    ]
    upstream = step.table
  }
  return { table: upstream, filters }
}
