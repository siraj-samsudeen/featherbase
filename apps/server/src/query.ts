import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type DocTypeMeta } from './meta'
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

const OPS = ['=', '!=', '>', '<', '>=', '<=', 'like', 'not like', 'in', 'not in'] as const

const NO_COLUMN_TYPES = new Set(['Table', 'Section Break', 'Column Break'])

// Credential columns are never selectable or filterable (API-005/API-008).
const SENSITIVE_COLUMNS = new Set(['password_hash', 'api_secret_hash', 'api_key', 'new_password'])

function columnSet(meta: DocTypeMeta): Set<string> {
  const cols = new Set<string>(STANDARD_COLUMNS)
  for (const f of meta.fields)
    if (!NO_COLUMN_TYPES.has(f.fieldtype) && !SENSITIVE_COLUMNS.has(f.fieldname))
      cols.add(f.fieldname)
  return cols
}

function assertColumn(cols: Set<string>, field: string, what: string) {
  if (!cols.has(field))
    throw new AppError('ValidationError', `Unknown ${what} field`, {
      [field]: `Unknown field ${field}`,
    })
}

// Builds the permission-scoped WHERE fragment shared by list, count, and
// group-count: read permission + owner narrowing + user-permission narrowing +
// caller filters. Throws PermissionError (none) or ValidationError (single /
// bad filter). Returns the resolved meta, table name, and column set too.
async function scopedWhere(
  doctype: string,
  user: string,
  callerFilters: Filter[],
) {
  const meta = await getMeta(doctype)
  const scope = await permissionScope(user, doctype, 'read')
  if (scope === 'none')
    throw new AppError('PermissionError', `No read permission on ${doctype} for ${user}`)
  if (meta.issingle)
    throw new AppError(
      'ValidationError',
      `${doctype} is a Single DocType and has no list — open it directly by its name`,
    )
  const cols = columnSet(meta)
  const table = tableName(doctype)

  const filters = [...callerFilters]
  if (scope === 'owner') filters.push(['owner', '=', user])
  // PERM-005: user permissions narrow by the doctype itself and by any Link
  // field pointing at a restricted doctype.
  if (!(await isBypassUser(user))) {
    const upMap = await getUserPermissionMap(user)
    if (upMap.size) {
      const own = upMap.get(doctype)
      if (own) filters.push(['name', 'in', [...own]])
      for (const f of meta.fields) {
        if (f.fieldtype !== 'Link' || !f.options) continue
        const allowed = upMap.get(f.options)
        if (allowed) filters.push([f.fieldname, 'in', [...allowed]])
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
  const where = conds.length ? conds.reduce((acc, c) => sql`${acc} and ${c}`) : sql`true`
  return { meta, table, cols, where }
}

// DASH: count of matching documents (number card). Same permission scoping as
// getList; returns a single integer.
export async function countDocs(
  doctype: string,
  filters: Filter[] = [],
  user = 'Administrator',
): Promise<number> {
  const { table, where } = await scopedWhere(doctype, user, filters)
  const [{ count }] = await sql`select count(*)::int as count from ${sql(table)} where ${where}`
  return count as number
}

// UI-026: grouped counts for a bar chart — one { label, value } per distinct
// value of `field`, honoring permissions and filters. Ordered by descending
// count then label for a stable chart.
export async function groupCount(
  doctype: string,
  field: string,
  filters: Filter[] = [],
  user = 'Administrator',
): Promise<{ label: string; value: number }[]> {
  const { cols, table, where } = await scopedWhere(doctype, user, filters)
  assertColumn(cols, field, 'group_by')
  const rows = await sql`
    select ${sql(field)}::text as label, count(*)::int as value
    from ${sql(table)} where ${where}
    group by ${sql(field)}
    order by value desc, label asc`
  return rows.map((r) => ({ label: (r.label as string) ?? '', value: r.value as number }))
}

export async function getList(doctype: string, args: ListArgs = {}, user = 'Administrator') {
  const { meta, table, cols, where } = await scopedWhere(doctype, user, args.filters ?? [])

  const fields = args.fields?.length ? args.fields : ['name']
  for (const f of fields) assertColumn(cols, f, 'selected')

  let orderField = meta.sort_field || 'modified'
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
    select ${sql(fields)} from ${sql(table)}
    where ${where}
    order by ${sql(orderField)} ${orderDir === 'desc' ? sql`desc` : sql`asc`}
    limit ${limit} offset ${offset}`
  const [{ count }] = await sql`
    select count(*)::int as count from ${sql(table)} where ${where}`
  return { data: rows, total: count as number, limit_start: offset, limit_page_length: limit }
}
