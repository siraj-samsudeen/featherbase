import { sql } from './db'
import { AppError } from './errors'
import { appOperation } from './app-lifecycle'
import { getMeta } from './meta'
import { isBound } from './sources/dispatch'
import { MAX_RELATED_DEPTH } from 'shared'
import { hideRetired, scopedWhere, type Filter } from './query'
import { linkBase, storedTable } from './views'

// #1289 option C, Click To Narrow: the counts beside every value of every list
// in the panel, in one statement. A list is a path from the list's row to a
// value: forward along a link ({ column }), back from rows linking here
// ({ from, column }), or ending on a plain column such as a Choice. A list's
// counts apply the list's filters and every OTHER list's pick, never its own,
// so a picked list still shows what else is possible (the QlikView model).
//
// Access: every hop joins only the rows that hop's Table lets the viewer read
// (its own scopedWhere), so a value the viewer may not read is never named;
// its rows count as not linked, exactly as the `not related` filter reads them.

export type NarrowStep = { column: string } | { from: string; column: string }
export interface NarrowList {
  path: NarrowStep[]
  /** The filter this list's picks add to the list, applied to every other list. */
  pick?: Filter
}
export interface NarrowCounts {
  /** Per list, in request order: every value the list's rows reach, `null`
   *  for none, with how many rows reach it under the other lists' picks. */
  lists: { values: { value: string | null; count: number }[] }[]
}

export const MAX_NARROW_LISTS = 40

const bad = (message: string) => new AppError('ValidationError', message)

export function parseNarrowLists(raw: unknown): NarrowList[] {
  if (!Array.isArray(raw)) throw bad('lists must be an array of { path, pick? }')
  if (raw.length > MAX_NARROW_LISTS) throw bad(`At most ${MAX_NARROW_LISTS} lists per request`)
  return raw.map((l) => {
    if (!l || typeof l !== 'object' || !Array.isArray((l as NarrowList).path)) throw bad('Each list needs a path')
    const { path, pick } = l as NarrowList
    if (path.length > MAX_RELATED_DEPTH) throw bad(`A list's path is at most ${MAX_RELATED_DEPTH} steps`)
    for (const s of path) {
      const step = s as Record<string, unknown>
      if (!step || typeof step !== 'object' || typeof step.column !== 'string' || !step.column ||
        (step.from !== undefined && (typeof step.from !== 'string' || !step.from)))
        throw bad('Each step is { column } or { from, column }')
    }
    if (pick !== undefined && !Array.isArray(pick)) throw bad('A pick is one [field, operator, value] filter')
    return { path, ...(pick ? { pick } : {}) }
  })
}

export function narrowCounts(...args: Parameters<typeof narrowCountsImpl>) {
  return appOperation(() => narrowCountsImpl(...args))
}

async function narrowCountsImpl(
  table: string,
  filters: Filter[],
  lists: NarrowList[],
  user: string,
  opts: { withRetired?: boolean } = {},
): Promise<NarrowCounts> {
  const stored = await getMeta(await storedTable(table))
  if (isBound(stored)) throw bad(`${table} is bound to data source ${stored.data_source}: Click To Narrow counts only Featherbase's own Tables`)
  if (!lists.length) return { lists: [] }
  const baseFilters = hideRetired(stored, filters, opts.withRetired)
  const base = await scopedWhere(table, user, baseFilters)
  const rowKey = sql`${sql(base.table)}.${sql(base.meta.row_key)}`
  const parts: ReturnType<typeof sql>[] = []
  for (const [i, list] of lists.entries()) {
    const others = lists.flatMap((l, j) => (j !== i && l.pick ? [l.pick] : []))
    const live = others.length ? await scopedWhere(table, user, [...baseFilters, ...others]) : base
    const { joins, value } = await pathJoins(i, list.path, base, user)
    // A forward path reaches at most one value per row: a plain count is exact.
    if (!list.path.some((s) => 'from' in s)) {
      parts.push(sql`
        select ${i}::int as list, nullif((${value})::text, '') as value,
          (count(*) filter (where ${live.where}))::int as count
        from ${sql(base.table)} ${joins}
        where ${base.where}
        group by 2`)
      continue
    }
    // A path that fans out (through a link table) can reach a value along one
    // branch and nothing along another: such a row is linked, as `not related`
    // reads it, so only a row reaching no value at all counts as none.
    parts.push(sql`
      select ${i}::int as list, narrow_row.value,
        (count(distinct narrow_row.row_key) filter (where narrow_row.live and (narrow_row.value is not null or not narrow_row.reached)))::int as count
      from (
        select ${rowKey} as row_key, nullif((${value})::text, '') as value, (${live.where}) as live,
          bool_or(nullif((${value})::text, '') is not null) over (partition by ${rowKey}) as reached
        from ${sql(base.table)} ${joins}
        where ${base.where}) narrow_row
      group by narrow_row.value
      having narrow_row.value is not null or bool_or(not narrow_row.reached)`)
  }
  const rows = await sql<{ list: number; value: string | null; count: number }[]>`
    ${parts.reduce((acc, p) => sql`${acc} union all ${p}`)}
    order by 1, 3 desc, 2 asc nulls last`
  // Each list groups by its normalised value, so every row is one value: append (Codex: no per-value scan).
  const out: NarrowCounts['lists'] = lists.map(() => ({ values: [] }))
  for (const r of rows) out[r.list].values.push({ value: r.value, count: r.count })
  return { lists: out }
}

type Scoped = Awaited<ReturnType<typeof scopedWhere>>
type Frag = Scoped['where']
interface At { meta: Scoped['meta']; cols: Set<string>; id: Frag; read: (column: string) => Frag }

/** The left joins that walk one list's path from the list's row, each through
 *  the rows its Table lets the viewer read, and the value the path ends on. */
async function pathJoins(list: number, path: NarrowStep[], base: Scoped, user: string) {
  let joins = sql``
  // Where the walk stands: the Table, how to read a column of the row there,
  // and that row's id.
  let at: At = {
    meta: base.meta,
    cols: base.cols,
    id: sql`${sql(base.table)}.${sql(base.meta.row_key)}`,
    read: base.readExpression,
  }
  for (const [k, step] of path.entries()) {
    const alias = `narrow_${list}_${k}`
    const next = path[k + 1]
    // A hop's derived table carries the column the next forward step reads.
    const carry = (hop: Scoped) => next && !('from' in next) ? (readable(hop, next.column), sql`, ${hop.readExpression(next.column)} as fb_next`) : sql``
    if ('from' in step) {
      const hop = await scopedWhere(step.from, user, [])
      readable(hop, step.column)
      const back = hop.meta.columns.find((c) => c.column_name === step.column && c.column_type === 'Reference')
      if (!back || back.table_column || linkBase(back) !== at.meta.name)
        throw bad(`${step.from}.${step.column} is not a link to ${at.meta.name}`)
      joins = sql`${joins} left join (
        select ${sql(hop.meta.row_key)} as fb_id, ${hop.readExpression(step.column)} as fb_back ${carry(hop)}
        from ${sql(hop.table)} where ${hop.where}) ${sql(alias)} on ${sql(alias)}.fb_back = ${at.id}`
      at = hopAt(alias, hop)
      continue
    }
    readable(at, step.column)
    const col = at.meta.columns.find((c) => c.column_name === step.column)
    const reference = col?.column_type === 'Reference' && col.reference_table && !col.table_column ? col.reference_table : null
    if (!reference) {
      // A plain column (a Choice) ends the path: its value is the list's value.
      if (next) throw bad(`A list's path cannot go on past ${at.meta.name}.${step.column}`)
      if (col && (col.column_type === 'Sub-table' || col.column_type === 'Reference'))
        throw bad(`${at.meta.name}.${step.column} cannot be a list`)
      return { joins, value: at.read(step.column) }
    }
    const hop = await scopedWhere(reference, user, [])
    joins = sql`${joins} left join (
      select ${sql(hop.meta.row_key)} as fb_id ${carry(hop)}
      from ${sql(hop.table)} where ${hop.where}) ${sql(alias)} on ${sql(alias)}.fb_id = ${at.read(step.column)}`
    at = hopAt(alias, hop)
  }
  return { joins, value: at.id }
}

function hopAt(alias: string, hop: Scoped): At {
  return {
    meta: hop.meta,
    cols: hop.cols,
    id: sql`${sql(alias)}.fb_id`,
    // Only the next step's column is carried, as fb_next; `carry` checked it.
    read: () => sql`${sql(alias)}.fb_next`,
  }
}

function readable(at: { cols: Set<string>; meta: { name: string } }, column: string) {
  if (!at.cols.has(column))
    throw new AppError('ValidationError', 'Unknown list field', { [column]: `Unknown field ${column} on ${at.meta.name}` })
}
