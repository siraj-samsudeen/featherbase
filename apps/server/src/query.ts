import { sql } from './db'
import { AppError } from './errors'
import { ROW_KEY, getMeta, physicalRowKey, type TableMeta } from './meta'
import { STANDARD_COLUMNS, tableName } from './doctype-engine'
import { getUserPermissionMap, isBypassUser, permissionScope, permittedTiers } from './permissions'
import { SENSITIVE_COLUMNS } from './sensitive-columns'
import { boundCountDocs, boundGetList, boundGroupCount, isBound } from './sources/dispatch'

export type Filter = [string, string, unknown]

export interface ListArgs {
  filters?: Filter[]
  fields?: string[]
  order_by?: string
  limit_start?: number
  limit_page_length?: number
}

const OPS = ['=', '!=', '>', '<', '>=', '<=', 'like', 'not like', 'in', 'not in', 'related'] as const

// NAV-002: the 'related' operator — the ONE relationship-shaped filter the
// list language understands. It constrains rows by a relationship to
// another table's (recursively filtered, permission-scoped) rows instead of
// by a literal value list, compiling to IN/EXISTS subqueries entirely
// server-side. Three shapes, exactly the relationships the metadata models:
//
//   [refCol, 'related', { table, filters }]
//     rows whose Reference column points at a matching target row
//   ['parent', 'related', { table, filters }]        (sub-table rows only)
//     child rows whose owning parent row matches
//   ['name', 'related', { via, column, table, filters }]
//     rows CONTAINING a sub-table row whose Reference column points at a
//     matching target row (the "which POs contain this Item" case)
//
// `filters` recurses (a pane chain is a related filter inside a related
// filter), capped at MAX_RELATED_DEPTH. Every level runs through the target
// table's own scopedWhere — read permission, own_rows narrowing, and Data
// Scopes all apply per hop, so a related filter can never let a caller
// observe the effect of rows they cannot read.
//
// #106 review: depth alone doesn't bound cost — each hop runs permission
// queries BEFORE any SQL executes, so a wide payload of sibling specs is
// amplification. MAX_RELATED_HOPS caps the TOTAL specs compiled per
// request, breadth and depth together.
const MAX_RELATED_DEPTH = 3
const MAX_RELATED_HOPS = 16

interface RelatedSpec {
  table: string
  via?: string
  column?: string
  // #106 review: when one row table backs SEVERAL Sub-table columns
  // (sales_lines and return_lines both → Order Line), an optional
  // parentfield narrows the via hop to one owning column. Omitted = any
  // field, which is the right default for "is this row referenced at all"
  // (Connections counts).
  parentfield?: string
  filters?: Filter[]
}

function parseRelatedSpec(value: unknown): RelatedSpec {
  const bad = (message: string) => new AppError('ValidationError', message)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw bad(`'related' filter value must be an object { table, via?, column?, filters? }`)
  const v = value as Record<string, unknown>
  if (typeof v.table !== 'string' || !v.table)
    throw bad(`'related' filter needs a target { table }`)
  if (v.via !== undefined && (typeof v.via !== 'string' || !v.via))
    throw bad(`'related' via must be a sub-table name`)
  if (v.column !== undefined && (typeof v.column !== 'string' || !v.column))
    throw bad(`'related' column must be a column name`)
  // via and column travel together — a lone column would be silently
  // ignored by the Reference shape, and a lone via has no column to hop on.
  if (v.column !== undefined && v.via === undefined)
    throw bad(`'related' column only applies together with via`)
  if (v.via !== undefined && v.column === undefined)
    throw bad(`'related' via needs the sub-table column that references the target`)
  if (v.parentfield !== undefined && (typeof v.parentfield !== 'string' || !v.parentfield))
    throw bad(`'related' parentfield must be a Sub-table column name`)
  if (v.parentfield !== undefined && v.via === undefined)
    throw bad(`'related' parentfield only applies together with via`)
  if (v.filters !== undefined && !Array.isArray(v.filters))
    throw bad(`'related' filters must be an array of [field, operator, value]`)
  return {
    table: v.table,
    via: v.via as string | undefined,
    column: v.column as string | undefined,
    parentfield: v.parentfield as string | undefined,
    filters: v.filters as Filter[] | undefined,
  }
}

const NO_COLUMN_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break'])

// PERM-006: the columns a caller may name in select/filter/order/group.
// Tier filtering used to apply on detail reads only (filterReadFields), so a
// basic-tier caller could still SELECT, filter or sort by a restricted
// column through the list API and read its values — list and detail
// disagreeing about the same permission. Passing the permitted tiers closes
// that for native and (via dispatch.ts) source-bound Tables alike.
function columnSet(meta: TableMeta, readTiers?: Set<'basic' | 'restricted'>): Set<string> {
  const cols = new Set<string>(STANDARD_COLUMNS)
  for (const f of meta.columns)
    if (
      !NO_COLUMN_TYPES.has(f.column_type) &&
      !SENSITIVE_COLUMNS.has(f.column_name) &&
      (!readTiers || readTiers.has(f.tier ?? 'basic'))
    )
      cols.add(f.column_name)
  return cols
}

function assertColumn(cols: Set<string>, field: string, what: string) {
  if (!cols.has(field))
    throw new AppError('ValidationError', `Unknown ${what} field`, {
      [field]: `Unknown field ${field}`,
    })
}

// Builds the permission-scoped WHERE fragment shared by list, count, and
// group-count: read permission + created_by narrowing + user-permission
// narrowing + caller filters. Throws PermissionError (none) or
// ValidationError (single / bad filter). Returns the resolved meta, table
// name, and column set too.
async function scopedWhere(
  table: string,
  user: string,
  callerFilters: Filter[],
  relatedDepth = 0,
  // Shared across the whole recursion of ONE request — counts every
  // compiled related spec so breadth is bounded, not just depth.
  hopBudget = { hops: 0 },
) {
  if (!Array.isArray(callerFilters))
    throw new AppError('ValidationError', 'filters must be an array of [field, operator, value]')
  const meta = await getMeta(table)
  // scopedWhere compiles SQL against the local physical table, which a
  // source-bound Table does not have. Public entry points dispatch bound
  // Tables before reaching here; this guard covers the rest — notably a
  // 'related' filter TARGETING a bound Table (its rows live on the source,
  // so a scoped subquery cannot be compiled) and any future direct caller.
  if (isBound(meta))
    throw new AppError(
      'ValidationError',
      `${table} is bound to data source ${meta.data_source} — this operation cannot compile against it${relatedDepth > 0 ? " (a 'related' filter cannot target a source-bound Table)" : ''}`,
    )
  const scope = await permissionScope(user, table, 'read')
  if (scope === 'none')
    throw new AppError('PermissionError', `No read permission on ${table} for ${user}`)
  if (meta.kind === 'settings')
    throw new AppError(
      'ValidationError',
      `${table} is a Settings Table and has no list — open it directly by its name`,
    )
  const cols = columnSet(meta, await permittedTiers(user, table, 'read'))
  const tbl = tableName(table)
  // Callers always speak the logical row key (`row_id`); only the SQL we emit
  // uses the physical one, which differs for `Table` alone (see meta.ts).
  const phys = (field: string) => (field === ROW_KEY ? meta.row_key : field)

  const filters = [...callerFilters]
  // Extra WHERE fragments that can't be expressed as plain [field, op, value]
  // filters (they need OR with IS NULL).
  const extraConds: ReturnType<typeof sql>[] = []
  if (scope === 'own_rows') filters.push(['created_by', '=', user])
  // PERM-005: user permissions narrow by the table itself and by any
  // Reference column pointing at a restricted table. An UNSET reference does
  // not disqualify a row — the restriction applies to values, so NULL passes
  // (matches the detail-read check in permissions.ts, which skips empty
  // values).
  const bypass = await isBypassUser(user)
  // PERM-007: child rows are only as visible as the rows they hang on. The
  // Table grant says "may read rows of this shape"; the PARENT decides which
  // ones. Metadata already names every Table that can hold these rows (the
  // ones carrying a Sub-table column pointing here), so each becomes a
  // branch scoped to what the caller may see of it — and a parent Table the
  // caller cannot read at all contributes no branch, hiding its children.
  if (meta.kind === 'sub_table' && !bypass)
    extraConds.push((await parentScopeCond(meta.name, user)).frag)
  if (!bypass) {
    const upMap = await getUserPermissionMap(user)
    if (upMap.size) {
      const own = upMap.get(table)
      if (own) filters.push([ROW_KEY, 'in', [...own]])
      for (const f of meta.columns) {
        if (f.column_type !== 'Reference' || !f.reference_table) continue
        const allowed = upMap.get(f.reference_table)
        if (allowed)
          extraConds.push(
            sql`(${sql(f.column_name)} is null or ${sql(f.column_name)} in ${sql([...allowed])})`,
          )
      }
    }
  }
  // SQL fragments are thenables in the postgres client — awaiting one would
  // EXECUTE it. Async compilation therefore passes fragments boxed in
  // { frag } so `await` only ever resolves the box, never the fragment.
  const conds: ReturnType<typeof sql>[] = []
  for (const flt of filters) conds.push((await compileFilter(flt)).frag)

  async function compileFilter(flt: Filter): Promise<{ frag: ReturnType<typeof sql> }> {
    if (!Array.isArray(flt) || flt.length !== 3)
      throw new AppError('ValidationError', 'Each filter must be [field, operator, value]')
    const [field, op, value] = flt
    assertColumn(cols, field, 'filter')
    if (!OPS.includes(op as (typeof OPS)[number]))
      throw new AppError('ValidationError', `Unknown filter operator ${op}`)
    if (op === 'related') return relatedCond(field, value)
    return { frag: plainCond(field, op, value) }
  }

  function plainCond(logicalField: string, op: string, value: unknown): ReturnType<typeof sql> {
    const field = phys(logicalField)
    switch (op) {
      case '=': return sql`${sql(field)} = ${value as string}`
      case '!=': return sql`${sql(field)} is distinct from ${value as string}`
      case '>': return sql`${sql(field)} > ${value as string}`
      case '<': return sql`${sql(field)} < ${value as string}`
      case '>=': return sql`${sql(field)} >= ${value as string}`
      case '<=': return sql`${sql(field)} <= ${value as string}`
      case 'like': return sql`${sql(field)}::text ilike ${value as string}`
      case 'not like': return sql`${sql(field)}::text not ilike ${value as string}`
      case 'in': return sql`${sql(field)} in ${sql((value as string[]).length ? (value as string[]) : [null as never])}`
      default: return sql`${sql(field)} not in ${sql((value as string[]).length ? (value as string[]) : [null as never])}`
    }
  }

  // See the NAV-002 note on OPS: relationship filters compile to
  // permission-scoped subqueries by recursing into the TARGET table's own
  // scopedWhere, so every hop applies that table's read scoping.
  async function relatedCond(
    field: string,
    raw: unknown,
  ): Promise<{ frag: ReturnType<typeof sql> }> {
    if (relatedDepth >= MAX_RELATED_DEPTH)
      throw new AppError(
        'ValidationError',
        `'related' filters nest at most ${MAX_RELATED_DEPTH} levels deep`,
      )
    if (++hopBudget.hops > MAX_RELATED_HOPS)
      throw new AppError(
        'ValidationError',
        `At most ${MAX_RELATED_HOPS} 'related' hops per request`,
      )
    const spec = parseRelatedSpec(raw)
    const target = await scopedWhere(spec.table, user, spec.filters ?? [], relatedDepth + 1, hopBudget)

    if (spec.via) {
      if (field !== ROW_KEY)
        throw new AppError('ValidationError', `A via-related filter applies to '${ROW_KEY}'`)
      const owns = meta.columns.some(
        (f) => f.column_type === 'Sub-table' && f.row_table === spec.via,
      )
      if (!owns)
        throw new AppError('ValidationError', `${meta.name} has no sub-table ${spec.via}`)
      const viaMeta = await getMeta(spec.via)
      const viaCol = viaMeta.columns.find(
        (f) =>
          f.column_name === spec.column &&
          f.column_type === 'Reference' &&
          f.reference_table === spec.table,
      )
      if (!viaCol)
        throw new AppError(
          'ValidationError',
          `${spec.via}.${spec.column ?? '?'} is not a Reference to ${spec.table}`,
        )
      if (spec.parentfield !== undefined) {
        const owner = meta.columns.some(
          (f) =>
            f.column_type === 'Sub-table' &&
            f.row_table === spec.via &&
            f.column_name === spec.parentfield,
        )
        if (!owner)
          throw new AppError(
            'ValidationError',
            `${meta.name}.${spec.parentfield} is not a Sub-table column of ${spec.via} rows`,
          )
      }
      // Depth-indexed alias: self-referential or repeated-table nesting
      // resolves by construction, not by lexical-scoping luck (#106 review).
      const v = sql(`v${relatedDepth}`)
      const inTarget = sql`${v}.${sql(spec.column!)} in (select ${sql(target.meta.row_key)} from ${sql(target.table)} where ${target.where})`
      // `parent` holds the OWNING row's id, so it joins against this table's
      // own row key.
      const owner = sql`${sql(tbl)}.${sql(meta.row_key)}`
      return {
        frag:
          spec.parentfield !== undefined
            ? sql`exists (
                select 1 from ${sql(tableName(spec.via))} ${v}
                where ${v}.parent = ${owner} and ${v}.parenttype = ${meta.name}
                  and ${v}.parentfield = ${spec.parentfield} and ${inTarget})`
            : sql`exists (
                select 1 from ${sql(tableName(spec.via))} ${v}
                where ${v}.parent = ${owner} and ${v}.parenttype = ${meta.name}
                  and ${inTarget})`,
      }
    }

    if (field === 'parent') {
      if (meta.kind !== 'sub_table')
        throw new AppError(
          'ValidationError',
          `A 'parent' related filter applies to sub-table rows only`,
        )
      const owns = target.meta.columns.some(
        (f) => f.column_type === 'Sub-table' && f.row_table === meta.name,
      )
      if (!owns)
        throw new AppError('ValidationError', `${spec.table} does not contain ${meta.name} rows`)
      return {
        frag: sql`(parenttype = ${spec.table} and parent in (select ${sql(target.meta.row_key)} from ${sql(target.table)} where ${target.where}))`,
      }
    }

    const refCol = meta.columns.find(
      (f) => f.column_name === field && f.column_type === 'Reference',
    )
    if (!refCol || refCol.reference_table !== spec.table)
      throw new AppError(
        'ValidationError',
        `${meta.name}.${field} is not a Reference to ${spec.table}`,
      )
    return {
      frag: sql`${sql(phys(field))} in (select ${sql(target.meta.row_key)} from ${sql(target.table)} where ${target.where})`,
    }
  }

  const allConds = [...conds, ...extraConds]
  const where = allConds.length ? allConds.reduce((acc, c) => sql`${acc} and ${c}`) : sql`true`
  return { meta, table: tbl, cols, where, phys }
}

// One OR-branch per Table that can own rows of this child Table: 'all' scope
// admits every row parented there, 'own_rows' admits only those hanging off
// rows the caller created, 'none' admits nothing. No branch at all means no
// reachable parent, so the child list is empty rather than wide open.
// Boxed in { frag } for the same reason compileFilter is: a bare fragment is
// a thenable, and awaiting it would run the query instead of returning it.
async function parentScopeCond(
  childTable: string,
  user: string,
): Promise<{ frag: ReturnType<typeof sql> }> {
  const holders = await sql`
    select distinct parent as holder from column_def
    where column_type = 'Sub-table' and row_table = ${childTable}`
  const branches: ReturnType<typeof sql>[] = []
  for (const h of holders) {
    const holder = h.holder as string
    const holderMeta = await getMeta(holder).catch(() => null)
    // A source-bound Table has no local rows to scope against; the engine
    // refuses sub-tables on one, so this only guards against stale metadata.
    if (!holderMeta || isBound(holderMeta)) continue
    const scope = await permissionScope(user, holder, 'read')
    if (scope === 'none') continue
    branches.push(
      scope === 'all'
        ? sql`parenttype = ${holder}`
        : sql`(parenttype = ${holder} and parent in (
             select ${sql(physicalRowKey(holder))} from ${sql(tableName(holder))} where created_by = ${user}))`,
    )
  }
  if (!branches.length) return { frag: sql`false` }
  // Parenthesized: this fragment is ANDed into the WHERE, and AND binds
  // tighter than the ORs inside it.
  const anyParent = branches.reduce((acc, b) => sql`${acc} or ${b}`)
  return { frag: sql`(${anyParent})` }
}

// DASH: count of matching rows (number card). Same permission scoping as
// getList; returns a single integer.
export async function countDocs(
  table: string,
  filters: Filter[] = [],
  user = 'Administrator',
): Promise<number> {
  // M3 seam: source-bound Tables count on the source (spec EDS-5).
  const meta = await getMeta(table)
  if (isBound(meta)) return boundCountDocs(meta, filters, user)
  const { table: tbl, where } = await scopedWhere(table, user, filters)
  const [{ count }] = await sql`select count(*)::int as count from ${sql(tbl)} where ${where}`
  return count as number
}

// UI-026: grouped counts for a bar chart — one { label, value } per distinct
// value of `field`, honoring permissions and filters. Ordered by descending
// count then label for a stable chart.
export async function groupCount(
  table: string,
  field: string,
  filters: Filter[] = [],
  user = 'Administrator',
): Promise<{ label: string; value: number }[]> {
  const boundMeta = await getMeta(table)
  if (isBound(boundMeta)) return boundGroupCount(boundMeta, field, filters, user)
  const { cols, table: tbl, where, phys } = await scopedWhere(table, user, filters)
  assertColumn(cols, field, 'group_by')
  const rows = await sql`
    select ${sql(phys(field))}::text as label, count(*)::int as value
    from ${sql(tbl)} where ${where}
    group by ${sql(phys(field))}
    order by value desc, label asc`
  return rows.map((r) => ({ label: (r.label as string) ?? '', value: r.value as number }))
}

// NAV-002: scoped aggregates over the same filter language the list
// accepts — the true count (and optionally a sum) so a pane footer never
// has to add up only the rows it happened to fetch. The sum comes back as
// a STRING: Currency is numeric(21,9) and a float64 cast would silently
// lose precision the list path preserves (#106 review) — the client
// decides how to format, the server never rounds.
const SUMMABLE_TYPES = new Set(['Int', 'Float', 'Currency'])

export async function aggregateDocs(
  table: string,
  filters: Filter[] = [],
  sumField?: string,
  user = 'Administrator',
): Promise<{ count: number; sum: string | null }> {
  // Bound Tables: counts push down to the driver; sums are not implemented
  // on the source path yet — reject rather than 500 on a missing table.
  const boundMeta = await getMeta(table)
  if (isBound(boundMeta)) {
    if (sumField)
      throw new AppError(
        'ValidationError',
        `${table} is bound to data source ${boundMeta.data_source} — :aggregate sums are not supported on bound Tables yet`,
      )
    return { count: await boundCountDocs(boundMeta, filters, user), sum: null }
  }
  const { meta, cols, table: tbl, where } = await scopedWhere(table, user, filters)
  if (!sumField) {
    const [row] = await sql`select count(*)::int as count from ${sql(tbl)} where ${where}`
    return { count: row.count as number, sum: null }
  }
  assertColumn(cols, sumField, 'sum')
  const sumCol = meta.columns.find((f) => f.column_name === sumField)
  if (!sumCol || !SUMMABLE_TYPES.has(sumCol.column_type))
    throw new AppError('ValidationError', `sum must name an Int, Float, or Currency column`, {
      sum: `${sumField} is not a summable column`,
    })
  const [row] = await sql`
    select count(*)::int as count, coalesce(sum(${sql(sumField)}), 0)::text as sum
    from ${sql(tbl)} where ${where}`
  return { count: row.count as number, sum: row.sum as string }
}

export async function getList(table: string, args: ListArgs = {}, user = 'Administrator') {
  // M3 seam: source-bound Tables list from the source — filters, sort and
  // paging pushed down to the driver (spec EDS-5).
  const boundMeta = await getMeta(table)
  if (isBound(boundMeta)) return boundGetList(boundMeta, args, user)
  const { meta, table: tbl, cols, where, phys } = await scopedWhere(table, user, args.filters ?? [])

  const fields = args.fields?.length ? args.fields : [ROW_KEY]
  for (const f of fields) assertColumn(cols, f, 'selected')
  // The wire format always names the key `row_id`; where the physical column
  // differs (`Table`), alias it back so callers see one shape.
  const selection = fields
    .map((f) =>
      phys(f) === f ? sql`${sql(f)}` : sql`${sql(phys(f))} as ${sql(f)}`,
    )
    .reduce((acc, frag) => sql`${acc}, ${frag}`)

  let orderField = meta.sort_column || 'updated_at'
  let orderDir = (meta.sort_order || 'desc').toLowerCase()
  if (args.order_by) {
    const m = args.order_by.trim().match(/^([a-z][a-z0-9_]*)\s*(asc|desc)?$/i)
    if (!m) throw new AppError('ValidationError', `Invalid order_by ${args.order_by}`)
    orderField = m[1]
    orderDir = (m[2] ?? 'asc').toLowerCase()
  }
  assertColumn(cols, orderField, 'order_by')

  const limit = Math.min(Math.max(args.limit_page_length ?? 20, 1), 500)
  const offset = Math.max(args.limit_start ?? 0, 0)

  const rows = await sql`
    select ${selection} from ${sql(tbl)}
    where ${where}
    order by ${sql(phys(orderField))} ${orderDir === 'desc' ? sql`desc` : sql`asc`}
    limit ${limit} offset ${offset}`
  const [{ count }] = await sql`
    select count(*)::int as count from ${sql(tbl)} where ${where}`
  return { data: rows, total: count as number, limit_start: offset, limit_page_length: limit }
}
