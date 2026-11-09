import { sql } from './db'
import { AppError } from './errors'
import { permissionRefusal } from './refusals'
import { appOperation } from './app-lifecycle'
import { ROW_KEY, getMeta, physicalRowKey, type TableMeta } from './meta'
import { RETIREMENT_COLUMNS, STANDARD_COLUMNS, canRetire, tableRelation } from './table-engine'
import { getScopeMap, includesColumn, isPrivileged, permissionScope, permittedColumns, tableScope } from './permissions'
import { SENSITIVE_COLUMNS } from './sensitive-columns'
import { ROW_ATTACHED_TABLES, SENSITIVE_HISTORY_TABLES, childColumns, seesEveryColumn } from './row-readers'
import { boundCountDocs, boundGetList, boundGroupCount, isBound } from './sources/dispatch'
import { mandatoryWhere, needsMandatoryRowRead } from './mandatory-access'
import { MAX_RELATED_DEPTH, RELATED_OPS } from 'shared'
import { MAX_RELATED_HOPS, parseRelatedSpec, type Filter } from './related-filter'
import { linksTo } from './any-table-link'
import { linkBase, resolveView, storedTable, viewCondition } from './views'

export type { Filter } from './related-filter'

interface ListArgs {
  filters?: Filter[]
  fields?: string[]
  order_by?: string
  limit_start?: number
  limit_page_length?: number
  /** #859: list retired rows too (they are left out by default). */
  with_retired?: boolean
}

// #859 (ADR 0019): the list reads leave retired rows out unless the request
// asks for them, with `with_retired` or by filtering on retired_at itself.
// Only the entry points apply it, never scopedWhere: a related filter, the
// check that a comment's row is readable and scope providers still see
// retired rows, so retiring a row never changes what anyone may reach.
export function hideRetired(meta: TableMeta, filters: Filter[], withRetired = false): Filter[] {
  if (withRetired || !canRetire(meta) || !Array.isArray(filters)) return filters
  if (filters.some((f) => Array.isArray(f) && f[0] === 'retired_at')) return filters
  return [...filters, ['retired_at', '=', null]]
}

const OPS = ['=', '!=', '>', '<', '>=', '<=', 'like', 'not like', 'in', 'not in', ...RELATED_OPS] as const
/** The list language's filter operators, for texts that describe it (#1083, /mcp). */
export const LIST_OPERATORS: readonly string[] = OPS

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
const NO_COLUMN_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break'])

// PERM-006: the columns a caller may name in select/filter/order/group.
// Tier filtering used to apply on detail reads only (filterReadFields), so a
// basic-tier caller could still SELECT, filter or sort by a restricted
// column through the list API and read its values — list and detail
// disagreeing about the same permission. Passing the permitted tiers closes
// that for native and (via dispatch.ts) source-bound Tables alike.
function columnSet(meta: TableMeta, readable?: ReadonlySet<string>): Set<string> {
  const cols = new Set<string>(STANDARD_COLUMNS)
  if (canRetire(meta)) for (const c of RETIREMENT_COLUMNS) cols.add(c)
  for (const f of meta.columns)
    if (
      !NO_COLUMN_TYPES.has(f.column_type) &&
      !SENSITIVE_COLUMNS.has(f.column_name) &&
      (!readable || includesColumn(readable, f))
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

// Builds the permission-scoped WHERE fragment shared by list, count,
// group-count, and search: read permission + created_by narrowing + user-permission
// narrowing + caller filters. Throws PermissionError (none) or
// ValidationError (single / bad filter). Returns the resolved meta, table
// name, and column set too.
export async function scopedWhere(
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
  // #1021: a view reads as its base, and only as its base: every check
  // below names the base Table, and the view's filter is one more system
  // condition on top.
  const resolved = await resolveView(table)
  table = resolved.table
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
    throw await permissionRefusal(user, table, 'read')
  if (meta.kind === 'settings')
    throw new AppError(
      'ValidationError',
      `${table} is a Settings Table and has no list — open it directly by its name`,
    )
  const cols = columnSet(meta, await permittedColumns(user, table, 'read'))
  const tbl = await tableRelation(table)
  // Callers always speak the logical row key (`row_id`); only the SQL we emit
  // uses the physical one, which differs for `Table` alone (see meta.ts).
  const phys = (field: string) => (field === ROW_KEY ? meta.row_key : field)
  const unrestricted = await permittedColumns(user, table, 'read', '')
  const creatorColumns = new Set(meta.columns.filter((column) =>
    cols.has(column.column_name) && !includesColumn(unrestricted, column)).map((column) => column.column_name))
  // Apply the Column's own scope before selecting, sorting or aggregating.
  // An unrelated unrestricted Row grant must never expose this value.
  const readExpression = (field: string) => creatorColumns.has(field)
    ? sql`case when ${sql(tbl)}.created_by = ${user} then ${sql(phys(field))} else null end`
    : sql`${sql(phys(field))}`

  const filters = [...callerFilters]
  // Extra WHERE fragments that can't be expressed as plain [field, op, value]
  // filters (they need OR with IS NULL).
  const extraConds: ReturnType<typeof sql>[] = [(await mandatoryWhere(meta, user)).frag]
  if (resolved.view) extraConds.push(viewCondition(tbl, resolved.filters))
  if (scope === 'own_rows') filters.push(['created_by', '=', user])
  // PERM-005: user permissions narrow by the table itself and by any
  // Reference column pointing at a restricted table. An UNSET reference does
  // not disqualify a row — the restriction applies to values, so NULL passes
  // (matches the detail-read check in permissions.ts, which skips empty
  // values).
  const bypass = await isPrivileged(user)
  // PERM-007: child rows are only as visible as the rows they hang on. The
  // Table grant says "may read rows of this shape"; the PARENT decides which
  // ones. Metadata already names every Table that can hold these rows (the
  // ones carrying a Sub-table column pointing here), so each becomes a
  // branch scoped to what the caller may see of it — and a parent Table the
  // caller cannot read at all contributes no branch, hiding its children.
  if (meta.kind === 'sub_table')
    extraConds.push((await parentScopeCond(meta.name, user)).frag)
  // #342: likewise a comment or an edit is only as visible as its row.
  if (ROW_ATTACHED_TABLES.has(meta.name))
    extraConds.push((await attachedRowScopeCond(meta.name, user, callerFilters)).frag)
  if (!bypass) {
    const scope = tableScope(meta, await getScopeMap(user))
    if (scope?.none) extraConds.push(sql`false`)
    else if (scope) {
      if (scope.own) filters.push([ROW_KEY, 'in', [...scope.own]])
      for (const ref of scope.refs)
        extraConds.push(ref.unsetPasses
          ? sql`(${sql(ref.column)} is null or ${sql(ref.column)} in ${sql([...ref.allowed])})`
          : sql`${sql(ref.column)} in ${sql([...ref.allowed])}`)
    }
  }
  // #432: history outlives its Table, but never attaches to a namesake
  // created later. On a system-written Table, a row naming a Table is listed
  // only if that name has not been re-created since the row was written.
  // (Both dates come from the database clock.)
  // NOT EXISTS, not a scalar subquery: the planner turns it into an anti-join
  // (a per-row subplan made an unfiltered count ~100x slower on 1M rows).
  // Columns are qualified with the relation because this predicate can nest
  // inside a 'related' filter's subquery.
  if (meta.system_written)
    for (const f of meta.columns)
      if (f.column_type === 'Reference' && f.reference_table === 'Table')
        extraConds.push(sql`not exists (
          select 1 from table_def td
          where td.name = ${sql(tbl)}.${sql(f.column_name)}
            and td.created_at > ${sql(tbl)}.created_at)`)
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
    let condition: { frag: ReturnType<typeof sql> }
    if (op === 'related') condition = await relatedCond(field, value)
    // #835: rows holding NONE of a sub-table's matching rows ("people with no
    // role of their own"). Only the via shape: negating a Reference match
    // would also have to decide what an empty reference means.
    else if (op === 'not related') {
      const spec = parseRelatedSpec(value)
      if (!spec.via) throw new AppError('ValidationError', `'not related' needs a sub-table { via, column, table }`)
      const { frag } = await relatedCond(field, value)
      condition = { frag: sql`not ${frag}` }
    } else condition = { frag: plainCond(field, op, value) }
    return { frag: creatorColumns.has(field)
      ? sql`(${sql(tbl)}.created_by = ${user} and ${condition.frag})`
      : condition.frag }
  }

  function plainCond(logicalField: string, op: string, value: unknown): ReturnType<typeof sql> {
    const field = phys(logicalField)
    switch (op) {
      // Null-aware like '!=' below: `[col, '=', null]` means "is empty"
      // (person-resolution: the Person picker's `replaced_by` filter).
      case '=': return value === null ? sql`${sql(field)} is null` : sql`${sql(field)} = ${value as string}`
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
      // #881: or a link to a row of any Table that may name spec.table; its
      // Table column must then name it too.
      const viaCol = viaMeta.columns.find(
        (f) =>
          f.column_name === spec.column &&
          f.column_type === 'Reference' &&
          ((!!f.reference_table && linkBase(f) === target.meta.name) || (!!f.table_column && linksTo(f.choices, spec.table))),
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
      // #917: a line-item Reference filters only through grids and line-item
      // Columns this reader may read on every row; a hidden relationship must
      // not shape the answer.
      const grids: string[] = []
      for (const link of meta.columns.filter((f) => f.column_type === 'Sub-table' && f.row_table === spec.via &&
        (spec.parentfield === undefined || f.column_name === spec.parentfield))) {
        // Rows limited to the caller's own may use their creator-scoped reach.
        const ownOnly = scope === 'own_rows'
        const linkReach = ownOnly ? await permittedColumns(user, table, 'read') : unrestricted
        if (!includesColumn(linkReach, link)) continue
        if (includesColumn(await childColumns(user, meta.name, spec.via, link.row_id, 'read', ownOnly ? user : ''), viaCol)) grids.push(link.column_name)
      }
      if (!grids.length)
        throw new AppError('PermissionError', `No read permission on ${spec.via}.${spec.column}`)
      // Depth-indexed alias: self-referential or repeated-table nesting
      // resolves by construction, not by lexical-scoping luck (#106 review).
      const v = sql(`v${relatedDepth}`)
      const inRows = sql`${v}.${sql(spec.column!)} in (select ${sql(target.meta.row_key)} from ${sql(target.table)} where ${target.where})`
      const inTarget = viaCol.table_column ? sql`${v}.${sql(viaCol.table_column)} = ${spec.table} and ${inRows}` : inRows
      // `parent` holds the OWNING row's id, so it joins against this table's
      // own row key.
      const owner = sql`${sql(tbl)}.${sql(meta.row_key)}`
      return {
        frag:
          spec.parentfield !== undefined
            ? sql`exists (
                select 1 from ${sql(await tableRelation(spec.via))} ${v}
                where ${v}.parent = ${owner} and ${v}.parenttype = ${meta.name}
                  and ${v}.parentfield = ${spec.parentfield} and ${inTarget})`
            : sql`exists (
                select 1 from ${sql(await tableRelation(spec.via))} ${v}
                where ${v}.parent = ${owner} and ${v}.parenttype = ${meta.name}
                  and ${v}.parentfield in ${sql(grids)} and ${inTarget})`,
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
    // #1021: a link to a view and one to its base hold the same rows.
    if (!refCol || !refCol.reference_table || linkBase(refCol) !== target.meta.name)
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
  return { meta, table: tbl, cols, where, phys, readExpression, creatorColumns }
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
      scope === 'all' && !holderMeta.access_policy
        ? sql`parenttype = ${holder}`
        : sql`(parenttype = ${holder} and parent in (
             select ${sql(physicalRowKey(holder))} from ${sql(await tableRelation(holder))}
             where ${(await mandatoryWhere(holderMeta, user)).frag} and ${scope === 'own_rows' ? sql`created_by = ${user}` : sql`true`}))`,
    )
  }
  if (!branches.length) return { frag: sql`false` }
  // Parenthesized: this fragment is ANDed into the WHERE, and AND binds
  // tighter than the ORs inside it.
  const anyParent = branches.reduce((acc, b) => sql`${acc} or ${b}`)
  return { frag: sql`(${anyParent})` }
}

// #342: one OR-branch per Table that rows of this Comment/Version Table are
// attached to: the rows of it the caller may list (the same scoping a list
// of that Table applies, own-rows, Data Scopes and parents included) plus
// any row shared with them for reading. A Settings Table's single row goes
// with read on it. A Table the caller cannot read contributes only its
// shared rows; for Version, so does a Table with a column the caller's tiers
// do not reach (seesEveryColumn). A row on a Table that no longer exists,
// or one bound to an outside source, is left to the row's activity, which
// opens the row itself. Columns are qualified so the predicate also holds
// inside a 'related' subquery.
// A list that names its Table (the row's panels and apps all do) builds that
// one branch, without first reading which Tables the rows hang on. A row not
// attached to one row (#609: a File on a whole Table, or on nothing) has no
// row to defer to, so the grant on its own Table, already applied, governs.
// A row of a source-bound Table is opened through the bound read gate, so
// one passing that gate with no Data Scope narrowing it sees what hangs on
// every row of it; anyone else reaches those through the row itself.
async function attachedRowScopeCond(
  table: string,
  user: string,
  callerFilters: Filter[],
): Promise<{ frag: ReturnType<typeof sql> }> {
  const rel = sql(await tableRelation(table))
  const pinned = callerFilters.find(
    (f) => Array.isArray(f) && f[0] === 'ref_table' && f[1] === '=' && typeof f[2] === 'string',
  )?.[2] as string | undefined
  const targets = pinned !== undefined
    ? [pinned]
    : (await sql`select distinct ref_table from ${rel} where ref_table is not null`).map((r) => String(r.ref_table))
  const branches: ReturnType<typeof sql>[] = table === 'File' ? [sql`coalesce(${rel}.ref_name, '') = ''`] : []
  const scopes = await getScopeMap(user)
  const privileged = await isPrivileged(user)
  for (const target of targets) {
    if (privileged && !(await needsMandatoryRowRead(target))) {
      branches.push(sql`${rel}.ref_table = ${target}`)
      continue
    }
    const targetMeta = ROW_ATTACHED_TABLES.has(target) ? null : await getMeta(target).catch(() => null)
    if (!targetMeta) continue
    if (!targetMeta.access_policy) branches.push(sql`(${rel}.ref_table = ${target} and ${rel}.ref_name in (
      select share_name from share where share_table = ${target} and read = true
        and (person = ${user} or service_account = ${user})))`)
    const scope = await permissionScope(user, target, 'read')
    if (scope === 'none') continue
    const ownHistoryOnly = SENSITIVE_HISTORY_TABLES.has(table) && !(await seesEveryColumn(user, targetMeta))
    if (ownHistoryOnly && !(await seesEveryColumn(user, targetMeta, user))) continue
    if (isBound(targetMeta)) {
      const narrowed = tableScope(targetMeta, scopes) !== null
      if (scope === 'all' && !narrowed && !ownHistoryOnly) branches.push(sql`${rel}.ref_table = ${target}`)
      continue
    }
    if (targetMeta.kind === 'settings') {
      if (!ownHistoryOnly) branches.push(sql`${rel}.ref_table = ${target}`)
      continue
    }
    const scoped = await scopedWhere(target, user, [])
    const visible = ownHistoryOnly ? sql`${scoped.where} and created_by = ${user}` : scoped.where
    branches.push(sql`(${rel}.ref_table = ${target} and ${rel}.ref_name in (
      select ${sql(scoped.meta.row_key)} from ${sql(scoped.table)} where ${visible}))`)
  }
  if (!branches.length) return { frag: sql`false` }
  return { frag: sql`(${branches.reduce((acc, b) => sql`${acc} or ${b}`)})` }
}

// DASH: count of matching rows (number card). Same permission scoping as
// getList; returns a single integer.
export function countDocs(...args: Parameters<typeof countDocsImpl>) {
  return appOperation(() => countDocsImpl(...args))
}
async function countDocsImpl(
  table: string,
  filters: Filter[] = [],
  user = 'Administrator',
  opts: { withRetired?: boolean } = {},
): Promise<number> {
  // M3 seam: source-bound Tables count on the source (spec EDS-5).
  const meta = await getMeta(await storedTable(table))
  if (isBound(meta)) return boundCountDocs(meta, filters, user)
  const { table: tbl, where } = await scopedWhere(table, user, hideRetired(meta, filters, opts.withRetired))
  const [{ count }] = await sql`select count(*)::int as count from ${sql(tbl)} where ${where}`
  return count as number
}

// UI-026: grouped counts for a bar chart — one { label, value } per distinct
// value of `field`, honoring permissions and filters. Ordered by descending
// count then label for a stable chart.
export function groupCount(...args: Parameters<typeof groupCountImpl>) {
  return appOperation(() => groupCountImpl(...args))
}
async function groupCountImpl(
  table: string,
  field: string,
  filters: Filter[] = [],
  user = 'Administrator',
): Promise<{ label: string; value: number }[]> {
  const boundMeta = await getMeta(await storedTable(table))
  if (isBound(boundMeta)) return boundGroupCount(boundMeta, field, filters, user)
  const { cols, table:tbl, where, phys, readExpression } = await scopedWhere(table, user, hideRetired(boundMeta, filters))
  assertColumn(cols, field, 'group_by')
  const rows = await sql`
    select permission_group.group_value::text as label, count(*)::int as value
    from ${sql(tbl)} cross join lateral (select ${readExpression(field)} as group_value) permission_group
    where ${where}
    group by permission_group.group_value
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

export function aggregateDocs(...args: Parameters<typeof aggregateDocsImpl>) {
  return appOperation(() => aggregateDocsImpl(...args))
}
async function aggregateDocsImpl(
  table: string,
  filters: Filter[] = [],
  sumField?: string,
  user = 'Administrator',
): Promise<{ count: number; sum: string | null }> {
  // Bound Tables: counts push down to the driver; sums are not implemented
  // on the source path yet — reject rather than 500 on a missing table.
  const boundMeta = await getMeta(await storedTable(table))
  if (isBound(boundMeta)) {
    if (sumField)
      throw new AppError(
        'ValidationError',
        `${table} is bound to data source ${boundMeta.data_source} — :aggregate sums are not supported on bound Tables yet`,
      )
    return { count: await boundCountDocs(boundMeta, filters, user), sum: null }
  }
  const { meta, cols, table:tbl, where, readExpression } = await scopedWhere(table, user, hideRetired(boundMeta, filters))
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
    select count(*)::int as count, coalesce(sum(${readExpression(sumField)}), 0)::text as sum
    from ${sql(tbl)} where ${where}`
  return { count: row.count as number, sum: row.sum as string }
}

// #330: a summary view's totals — the count and the chosen sums overall and
// per value of one column, over EVERY matching row (same permission scope and
// filters as the list), so a report never adds up only the page it fetched.
// Groups come in the order the list sorts that column (empty last). Sums are
// strings for the same precision reason as aggregateDocs.
export interface Summary {
  count: number
  sums: Record<string, string>
  groups: { value: string | null; count: number; sums: Record<string, string> }[]
}
export function summarizeDocs(...args: Parameters<typeof summarizeDocsImpl>) {
  return appOperation(() => summarizeDocsImpl(...args))
}
async function summarizeDocsImpl(
  table: string,
  filters: Filter[] = [],
  groupBy: string | undefined,
  sumFields: string[] = [],
  user = 'Administrator',
  opts: { withRetired?: boolean } = {},
): Promise<Summary> {
  // Bound Tables: counts push down to the driver; sums are not implemented
  // on the source path yet, as for :aggregate.
  const boundMeta = await getMeta(await storedTable(table))
  if (isBound(boundMeta)) {
    if (sumFields.length)
      throw new AppError(
        'ValidationError',
        `${table} is bound to data source ${boundMeta.data_source} — :summary sums are not supported on bound Tables yet`,
      )
    const count = await boundCountDocs(boundMeta, filters, user)
    // The driver orders by count and names an empty value ''; a summary lists
    // groups in the column's order, empty last, like every other Table.
    const groups = groupBy
      ? (await boundGroupCount(boundMeta, groupBy, filters, user))
          .map((g) => ({ value: g.label === '' ? null : g.label, count: g.value, sums: {} }))
          .sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
      : []
    return { count, sums: {}, groups }
  }
  const { meta, cols, table:tbl, where, phys, readExpression } = await scopedWhere(table, user, hideRetired(boundMeta, filters, opts.withRetired))
  for (const f of sumFields) {
    assertColumn(cols, f, 'sum')
    const col = meta.columns.find((c) => c.column_name === f)
    if (!col || !SUMMABLE_TYPES.has(col.column_type))
      throw new AppError('ValidationError', `sum must name an Int, Float, or Currency column`, {
        sum: `${f} is not a summable column`,
      })
  }
  if (groupBy) assertColumn(cols, groupBy, 'group_by')
  const sumSelect = sumFields.reduce(
    (acc, f, i) => sql`${acc}, coalesce(sum(${readExpression(f)}), 0)::text as ${sql(`s${i}`)}`,
    sql``,
  )
  const sumsOf = (row: Record<string, unknown>) =>
    Object.fromEntries(sumFields.map((f, i) => [f, row[`s${i}`] as string]))
  const [total] = await sql`
    select count(*)::int as count ${sumSelect} from ${sql(tbl)} where ${where}`
  const groups = groupBy
    ? (
        await sql`
          select permission_group.group_value::text as value, count(*)::int as count ${sumSelect}
          from ${sql(tbl)} cross join lateral (select ${readExpression(groupBy)} as group_value) permission_group
          where ${where}
          group by permission_group.group_value
          order by permission_group.group_value asc`
      ).map((r) => ({ value: (r.value as string | null) ?? null, count: r.count as number, sums: sumsOf(r) }))
    : []
  return { count: total.count as number, sums: sumsOf(total), groups }
}

export function getList(...args: Parameters<typeof getListImpl>) {
  return appOperation(() => getListImpl(...args))
}
async function getListImpl(table: string, args: ListArgs = {}, user = 'Administrator') {
  // M3 seam: source-bound Tables list from the source — filters, sort and
  // paging pushed down to the driver (spec EDS-5).
  const boundMeta = await getMeta(await storedTable(table))
  if (isBound(boundMeta)) return boundGetList(boundMeta, args, user)
  const { meta, table:tbl, cols, where, phys, readExpression } = await scopedWhere(table, user, hideRetired(boundMeta, args.filters ?? [], args.with_retired === true))

  const fields = args.fields?.length ? args.fields : [ROW_KEY]
  for (const f of fields) assertColumn(cols, f, 'selected')
  // The wire format always names the key `row_id`; where the physical column
  // differs (`Table`), alias it back so callers see one shape.
  const selection = fields
    .map((f) => sql`${readExpression(f)} as ${sql(f)}`)
    .reduce((acc, frag) => sql`${acc}, ${frag}`)

  // The Table's own sort applies only if this reader may read that Column; an
  // order_by they ask for themselves is still refused below.
  const defaultSort = meta.sort_column && cols.has(meta.sort_column)
  let orderField = defaultSort ? meta.sort_column! : 'updated_at'
  let orderDir = (defaultSort && meta.sort_order || 'desc').toLowerCase()
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
    order by ${readExpression(orderField)} ${orderDir === 'desc' ? sql`desc` : sql`asc`}${orderField === ROW_KEY ? sql`` : sql`, ${sql(phys(ROW_KEY))} asc`}
    limit ${limit} offset ${offset}`
  const [{ count }] = await sql`
    select count(*)::int as count from ${sql(tbl)} where ${where}`
  return { data: rows, total: count as number, limit_start: offset, limit_page_length: limit }
}
