import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type DocTypeMeta } from './meta'
import { STANDARD_COLUMNS, tableName } from './doctype-engine'

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

function columnSet(meta: DocTypeMeta): Set<string> {
  const cols = new Set<string>(STANDARD_COLUMNS)
  for (const f of meta.fields)
    if (!NO_COLUMN_TYPES.has(f.fieldtype)) cols.add(f.fieldname)
  return cols
}

function assertColumn(cols: Set<string>, field: string, what: string) {
  if (!cols.has(field))
    throw new AppError('ValidationError', `Unknown ${what} field`, {
      [field]: `Unknown field ${field}`,
    })
}

export async function getList(doctype: string, args: ListArgs = {}) {
  const meta = await getMeta(doctype)
  const cols = columnSet(meta)
  const table = tableName(doctype)

  const fields = args.fields?.length ? args.fields : ['name']
  for (const f of fields) assertColumn(cols, f, 'selected')

  const filters = args.filters ?? []
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
  const where = conds.length
    ? conds.reduce((acc, c) => sql`${acc} and ${c}`)
    : sql`true`

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
