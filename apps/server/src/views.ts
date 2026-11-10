// #1021: a view is a named, filtered lens on one stored Table (its base). It
// has no storage, no grants and no policy of its own. This module is the ONE
// place that turns a view's name into "base Table plus filter"; every read,
// permission check and link check asks it first, so a view can never reach
// more than its base allows.
import { sql } from './db'
import { AppError } from './errors'
import { assertRowsWritable } from './system-written'
import { getMeta, ROW_KEY, type ColumnDef, type TableMeta } from './meta'

export type ViewFilter = [string, string, unknown]

/** The operators a view's filter may use: plain comparisons on its base's
 *  own columns, nothing that reaches another Table. */
export const VIEW_OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'in', 'not in', 'like', 'not like'] as const

export interface ResolvedTable {
  /** The Table whose rows, grants and policy apply: the base for a view. */
  table: string
  /** The view's name when `name` was a view, else null. */
  view: string | null
  /** The view's filters (none for a Table). */
  filters: ViewFilter[]
}

/** Resolve a name to the stored Table it reads. A Table resolves to itself. */
export async function resolveView(name: string): Promise<ResolvedTable> {
  const meta = await getMeta(name)
  return resolvedFrom(meta)
}

export function resolvedFrom(meta: TableMeta): ResolvedTable {
  if (meta.kind !== 'view') return { table: meta.name, view: null, filters: [] }
  // table_def_view_shape: a view always has a base and filters.
  return { table: meta.view_of!, view: meta.name, filters: meta.view_filters! }
}

/** The stored Table a name reads: itself, or a view's base. Read from the
 *  persisted definition, so a permission probe never fails on metadata it
 *  would not otherwise load. */
export async function storedTable(name: string): Promise<string> {
  const [row] = await sql<{ base: string | null }[]>`
    select to_jsonb(d)->>'view_of' as base from table_def d where name = ${name}`
  return row?.base ?? name
}

/** The stored Table a link column's values are rows of. */
export function linkBase(column: Pick<ColumnDef, 'reference_table' | 'reference_base'>): string | null | undefined {
  return column.reference_base ?? column.reference_table
}

/** Every name a link to a row of `table` may carry as its target: the Table
 *  itself and each view of it. Delete blocks, row renames and purges look up
 *  links by these, so a link to a view protects its base's rows. */
export async function linkTargetNames(table: string, db: typeof sql = sql): Promise<string[]> {
  const views = await db<{ name: string }[]>`
    select name from table_def where to_jsonb(table_def)->>'view_of' = ${table} order by name`
  return [table, ...views.map((v) => v.name)]
}

/** The views of a Table, with their filters, for refusals that name them. */
export async function viewsOf(table: string, db: typeof sql = sql): Promise<{ name: string; filters: ViewFilter[] }[]> {
  const rows = await db<{ name: string; filters: ViewFilter[] }[]>`
    select name, to_jsonb(table_def)->'view_filters' as filters from table_def
    where to_jsonb(table_def)->>'view_of' = ${table} order by name`
  return rows.map((r) => ({ name: r.name, filters: r.filters }))
}

/** The filter as a system condition on the base's relation. It never passes
 *  the caller's column check: a reader who cannot see the filter column still
 *  reads the view. Columns are qualified so it also holds in a subquery. */
export function viewCondition(relation: string, filters: readonly ViewFilter[]): ReturnType<typeof sql> {
  const conds = filters.map(([column, op, value]) => {
    const col = sql`${sql(relation)}.${sql(column === ROW_KEY ? ROW_KEY : column)}`
    switch (op) {
      case '=': return value === null ? sql`${col} is null` : sql`${col} = ${value as string}`
      case '!=': return value === null ? sql`${col} is not null` : sql`${col} is distinct from ${value as string}`
      case '>': return sql`${col} > ${value as string}`
      case '<': return sql`${col} < ${value as string}`
      case '>=': return sql`${col} >= ${value as string}`
      case '<=': return sql`${col} <= ${value as string}`
      case 'like': return sql`${col}::text ilike ${value as string}`
      case 'not like': return sql`${col}::text not ilike ${value as string}`
      // An empty list: in nothing matches nothing, not in nothing excludes
      // nothing (#1137).
      case 'in': return (value as string[]).length ? sql`${col} in ${sql(value as string[])}` : sql`false`
      // normaliseViewFilters admits only VIEW_OPERATORS, so this is 'not in'.
      default: return (value as string[]).length ? sql`${col} not in ${sql(value as string[])}` : sql`true`
    }
  })
  return sql`(${conds.reduce((acc, c) => sql`${acc} and ${c}`, sql`true`)})`
}

/** Which of `ids` are rows of the view (existing base rows its filter
 *  matches). Unscoped: this is integrity, not reading. */
export async function rowsInView(db: typeof sql, view: TableMeta, ids: string[], relation: string): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { filters } = resolvedFrom(view)
  const rows = await db`select ${db(view.row_key)} as id from ${db(relation)}
    where ${db(view.row_key)} in ${db(ids)} and ${viewCondition(relation, filters)}`
  return new Set(rows.map((r) => String(r.id)))
}

/** #1021: every write addressed to a view is refused by the row-write gate
 *  (assertRowsWritable), so a row's comments, versions and shares stay with
 *  its base row. */
export function assertNotView(meta: Pick<TableMeta, 'name' | 'kind' | 'view_of' | 'system_written' | 'archived_at'>, action: string): void {
  if (meta.kind === 'view') assertRowsWritable(meta, action)
}

/** Check and normalise a view's filters against its base's columns. */
export function normaliseViewFilters(base: TableMeta, raw: unknown): ViewFilter[] {
  if (!Array.isArray(raw) || !raw.length)
    throw new AppError('ValidationError', 'A view needs at least one filter', { view_filters: 'Add a filter' })
  return raw.map((f, i) => {
    if (!Array.isArray(f) || f.length !== 3 || typeof f[0] !== 'string' || typeof f[1] !== 'string')
      throw new AppError('ValidationError', 'Each view filter is [column, operator, value]', { [`view_filters.${i}`]: 'Expected [column, operator, value]' })
    const [column, op, value] = f as [string, string, unknown]
    // A row's own id is a plain text column a view can name too.
    const col = column === ROW_KEY ? { column_type: 'Data' } : base.columns.find((c) => c.column_name === column)
    if (!col || ['Sub-table', 'Section Break', 'Column Break', 'JSON'].includes(col.column_type))
      throw new AppError('ValidationError', `${column} is not a column of ${base.name} a view can filter on`, { [`view_filters.${i}`]: `Unknown column ${column}` })
    if (!(VIEW_OPERATORS as readonly string[]).includes(op))
      throw new AppError('ValidationError', `A view filter cannot use ${op}`, { [`view_filters.${i}`]: `Unknown operator ${op}` })
    const list = op === 'in' || op === 'not in'
    if (list !== Array.isArray(value))
      throw new AppError('ValidationError', `${op} takes ${list ? 'a list of values' : 'one value'}`, { [`view_filters.${i}`]: 'Wrong value' })
    const one = (v: unknown): unknown => {
      if (v === null || v === undefined || v === '') return null
      if (col.column_type === 'Check') return v === true || v === 1 || v === '1' || v === 'true'
      if (['Int', 'Float', 'Currency'].includes(col.column_type)) {
        if (Number.isNaN(Number(v))) throw new AppError('ValidationError', `${column} takes a number`, { [`view_filters.${i}`]: 'Not a number' })
        return Number(v)
      }
      if (typeof v === 'object') throw new AppError('ValidationError', `${column} takes a plain value`, { [`view_filters.${i}`]: 'Not a plain value' })
      return String(v)
    }
    const normalised = list ? (value as unknown[]).map(one) : one(value)
    if (normalised === null && !['=', '!='].includes(op))
      throw new AppError('ValidationError', `${op} needs a value`, { [`view_filters.${i}`]: 'Needs a value' })
    return [column, op, normalised] as ViewFilter
  })
}

/** The columns a view's filters name: a base keeps them while the view does. */
export function filterColumns(filters: readonly ViewFilter[]): string[] {
  return [...new Set(filters.map((f) => f[0]))]
}
