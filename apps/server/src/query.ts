import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type TableMeta } from './meta'
import { STANDARD_COLUMNS, tableName } from './doctype-engine'
import { getUserPermissionMap, isBypassUser, permissionScope } from './permissions'
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

const OPS = ['=', '!=', '>', '<', '>=', '<=', 'like', 'not like', 'in', 'not in'] as const

const NO_COLUMN_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break'])

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
  const conds = filters.map((flt) => {
    if (!Array.isArray(flt) || flt.length !== 3)
      throw new AppError('ValidationError', 'Each filter must be [field, operator, value]')
    const [field, op, value] = flt
    assertColumn(cols, field, 'filter')
    if (!OPS.includes(op as (typeof OPS)[number]))
      throw new AppError('ValidationError', `Unknown filter operator ${op}`)
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
  })
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
  const { cols, table: tbl, where } = await scopedWhere(table, user, filters)
  assertColumn(cols, field, 'group_by')
  const rows = await sql`
    select ${sql(field)}::text as label, count(*)::int as value
    from ${sql(tbl)} where ${where}
    group by ${sql(field)}
    order by value desc, label asc`
  return rows.map((r) => ({ label: (r.label as string) ?? '', value: r.value as number }))
}

export async function getList(table: string, args: ListArgs = {}, user = 'Administrator') {
  // M3 seam: source-bound Tables list from the source — filters, sort and
  // paging pushed down to the driver (spec EDS-5).
  const boundMeta = await getMeta(table)
  if (isBound(boundMeta)) return boundGetList(boundMeta, args, user)
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
