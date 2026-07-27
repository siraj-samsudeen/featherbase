import { sql } from './db'
import { AppError } from './errors'

// Column types the engine understands (columns generated in META-002/003).
export const COLUMN_TYPE_VALUES = [
  'Data',
  'Int',
  'Float',
  'Currency',
  'Check',
  'Choice',
  'Date',
  'Datetime',
  'Text',
  'Long Text',
  'Reference',
  'Sub-table',
  'Attach',
  'Attach Image',
  'JSON',
  'Section Break',
  'Column Break',
] as const
export type ColumnType = (typeof COLUMN_TYPE_VALUES)[number]

export interface ColumnDef {
  name: string
  parent: string
  position: number
  column_name: string
  label: string | null
  column_type: ColumnType
  reference_table: string | null
  choices: string | null
  row_table: string | null
  reqd: boolean
  unique: boolean
  default_value: string | null
  read_only: boolean
  hidden: boolean
  in_list_view: boolean
  tier: 'basic' | 'restricted'
}

export interface TableMeta {
  name: string
  module: string
  kind: 'table' | 'sub_table' | 'settings'
  is_submittable: boolean
  id_pattern: string
  title_column: string | null
  sort_column: string
  sort_order: string
  track_changes: boolean
  description: string | null
  custom: boolean
  columns: ColumnDef[]
}

// META-011: per-process meta cache. Loads hit the DB once per Table; any
// metadata mutation must call invalidateMeta().
const cache = new Map<string, TableMeta>()
export const metaCacheStats = { loads: 0, hits: 0 }

// API-00x (#56): slug → Table name map, so /api/table/report-feedback
// reaches "Report Feedback" without %20. Lives and dies with the meta cache.
let slugCache: Map<string, string[]> | null = null

export function invalidateMeta(name?: string) {
  if (name) cache.delete(name)
  else cache.clear()
  slugCache = null
}

// CUST-002: coerce a Metadata Override's string value to the property's type.
const BOOLEAN_PROPS = new Set(['hidden', 'reqd', 'read_only', 'in_list_view', 'unique'])
function coerceProperty(property: string, value: unknown): unknown {
  if (BOOLEAN_PROPS.has(property)) return value === true || value === '1' || value === 'true'
  return value
}

let overrideTableExists: boolean | null = null
async function applyMetadataOverrides(name: string, meta: TableMeta): Promise<void> {
  if (overrideTableExists === null) {
    const [row] = await sql`
      select 1 as ok from information_schema.tables where table_name = 'metadata_override'`
    overrideTableExists = Boolean(row)
  }
  if (!overrideTableExists) return
  const overrides = await sql<{ column_name: string | null; property: string; value: string }[]>`
    select column_name, property, value from metadata_override where table_name = ${name}`
  for (const o of overrides) {
    const val = coerceProperty(o.property, o.value)
    if (o.column_name) {
      const f = meta.columns.find((x) => x.column_name === o.column_name)
      if (f) (f as unknown as Record<string, unknown>)[o.property] = val
    } else {
      ;(meta as unknown as Record<string, unknown>)[o.property] = val
    }
  }
}

// The slug normal form: case-insensitive, with runs of spaces, hyphens and
// underscores collapsed to one space. "Report Feedback", "report-feedback"
// and "report_feedback" all normalize to "report feedback".
function slugify(name: string): string {
  return name.toLowerCase().replace(/[-_\s]+/g, ' ').trim()
}

// #56: resolve a URL spelling of a Table name. The exact name always wins —
// the slug is an additional accepted spelling, never a replacement. An
// unknown input returns unchanged so the caller raises its usual NotFound;
// a slug matching two Tables is an error, never a silent pick.
export async function resolveTableName(input: string): Promise<string> {
  if (cache.has(input)) return input
  const [exact] = await sql`select 1 from table_def where name = ${input}`
  if (exact) return input
  if (!slugCache) {
    const rows = await sql`select name from table_def`
    const map = new Map<string, string[]>()
    for (const r of rows) {
      const slug = slugify(r.name as string)
      const names = map.get(slug)
      if (names) names.push(r.name as string)
      else map.set(slug, [r.name as string])
    }
    slugCache = map
  }
  const matches = slugCache.get(slugify(input)) ?? []
  if (matches.length > 1)
    throw new AppError(
      'ConflictError',
      `Ambiguous Table slug ${input}: matches ${matches.join(', ')} — use the exact name`,
    )
  return matches[0] ?? input
}

export async function getMeta(name: string): Promise<TableMeta> {
  const cached = cache.get(name)
  if (cached) {
    metaCacheStats.hits++
    return cached
  }
  const [dt] = await sql`select * from table_def where name = ${name}`
  if (!dt) throw new AppError('NotFoundError', `Table ${name} not found`)
  const columns = await sql<ColumnDef[]>`
    select * from column_def where parent = ${name} order by position, column_name`
  const meta = { ...(dt as unknown as Omit<TableMeta, 'columns'>), columns }

  // CUST-002: overlay Metadata Overrides onto the effective meta. The base
  // rows are never mutated — the override lives only in the loaded object.
  // (Guarded: the table doesn't exist yet during early bootstrap migrations.)
  await applyMetadataOverrides(name, meta)

  metaCacheStats.loads++
  cache.set(name, meta)
  return meta
}
