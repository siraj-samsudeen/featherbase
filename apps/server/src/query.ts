import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type TableMeta } from './meta'
import { STANDARD_COLUMNS, tableName } from './doctype-engine'
import { getUserPermissionMap, isBypassUser, permissionScope } from './permissions'

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
const MAX_RELATED_DEPTH = 3

interface RelatedSpec {
  table: string
  via?: string
  column?: string
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
  if (v.filters !== undefined && !Array.isArray(v.filters))
    throw bad(`'related' filters must be an array of [field, operator, value]`)
  return {
    table: v.table,
    via: v.via as string | undefined,
    column: v.column as string | undefined,
    filters: v.filters as Filter[] | undefined,
  }
}

const NO_COLUMN_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break'])

// Credential columns are never selectable or filterable (API-005/API-008).
const SENSITIVE_COLUMNS = new Set(['password_hash', 'api_secret_hash', 'api_key', 'new_password'])

function columnSet(meta: TableMeta): Set<string> {
  const cols = new Set<string>(STANDARD_COLUMNS)
  for (const f of meta.columns)
    if (!NO_COLUMN_TYPES.has(f.column_type) && !SENSITIVE_COLUMNS.has(f.column_name))
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
) {
  const meta = await getMeta(table)
  const scope = await permissionScope(user, table, 'read')
  if (scope === 'none')
    throw new AppError('PermissionError', `No read permission on ${table} for ${user}`)
  if (meta.kind === 'settings')
    throw new AppError(
      'ValidationError',
      `${table} is a Settings Table and has no list — open it directly by its name`,
    )
  const cols = columnSet(meta)
  const tbl = tableName(table)

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
  if (!(await isBypassUser(user))) {
    const upMap = await getUserPermissionMap(user)
    if (upMap.size) {
      const own = upMap.get(table)
      if (own) filters.push(['name', 'in', [...own]])
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

  function plainCond(field: string, op: string, value: unknown): ReturnType<typeof sql> {
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
    const spec = parseRelatedSpec(raw)
    const target = await scopedWhere(spec.table, user, spec.filters ?? [], relatedDepth + 1)

    if (spec.via) {
      if (field !== 'name')
        throw new AppError('ValidationError', `A via-related filter applies to 'name'`)
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
      return {
        frag: sql`exists (
          select 1 from ${sql(tableName(spec.via))} v
          where v.parent = ${sql(tbl)}.name and v.parenttype = ${meta.name}
            and v.${sql(spec.column!)} in (select name from ${sql(target.table)} where ${target.where}))`,
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
        frag: sql`(parenttype = ${spec.table} and parent in (select name from ${sql(target.table)} where ${target.where}))`,
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
      frag: sql`${sql(field)} in (select name from ${sql(target.table)} where ${target.where})`,
    }
  }

  const allConds = [...conds, ...extraConds]
  const where = allConds.length ? allConds.reduce((acc, c) => sql`${acc} and ${c}`) : sql`true`
  return { meta, table: tbl, cols, where }
}

// DASH: count of matching rows (number card). Same permission scoping as
// getList; returns a single integer.
export async function countDocs(
  table: string,
  filters: Filter[] = [],
  user = 'Administrator',
): Promise<number> {
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
  const { cols, table: tbl, where } = await scopedWhere(table, user, filters)
  assertColumn(cols, field, 'group_by')
  const rows = await sql`
    select ${sql(field)}::text as label, count(*)::int as value
    from ${sql(tbl)} where ${where}
    group by ${sql(field)}
    order by value desc, label asc`
  return rows.map((r) => ({ label: (r.label as string) ?? '', value: r.value as number }))
}

// NAV-002: scoped aggregates over the same filter language the list
// accepts — the true count (and optionally a sum) so a pane footer never
// has to add up only the rows it happened to fetch.
export async function aggregateDocs(
  table: string,
  filters: Filter[] = [],
  sumField?: string,
  user = 'Administrator',
): Promise<{ count: number; sum: number | null }> {
  const { cols, table: tbl, where } = await scopedWhere(table, user, filters)
  if (!sumField) {
    const [row] = await sql`select count(*)::int as count from ${sql(tbl)} where ${where}`
    return { count: row.count as number, sum: null }
  }
  assertColumn(cols, sumField, 'sum')
  const [row] = await sql`
    select count(*)::int as count, coalesce(sum(${sql(sumField)}), 0)::float as sum
    from ${sql(tbl)} where ${where}`
  return { count: row.count as number, sum: Number(row.sum) }
}

export async function getList(table: string, args: ListArgs = {}, user = 'Administrator') {
  const { meta, table: tbl, cols, where } = await scopedWhere(table, user, args.filters ?? [])

  const fields = args.fields?.length ? args.fields : ['name']
  for (const f of fields) assertColumn(cols, f, 'selected')

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
    select ${sql(fields)} from ${sql(tbl)}
    where ${where}
    order by ${sql(orderField)} ${orderDir === 'desc' ? sql`desc` : sql`asc`}
    limit ${limit} offset ${offset}`
  const [{ count }] = await sql`
    select count(*)::int as count from ${sql(tbl)} where ${where}`
  return { data: rows, total: count as number, limit_start: offset, limit_page_length: limit }
}
