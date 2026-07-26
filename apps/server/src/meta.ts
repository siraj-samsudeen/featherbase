import { sql } from './db'
import { AppError } from './errors'

// Field types the engine understands (columns generated in META-002/003).
export const FIELD_TYPES = [
  'Data',
  'Int',
  'Float',
  'Currency',
  'Check',
  'Select',
  'Date',
  'Datetime',
  'Text',
  'Long Text',
  'Link',
  'Table',
  'Attach',
  'Attach Image',
  'JSON',
  'Section Break',
  'Column Break',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export interface DocField {
  name: string
  parent: string
  idx: number
  fieldname: string
  label: string | null
  fieldtype: FieldType
  options: string | null
  reqd: boolean
  unique: boolean
  default_value: string | null
  read_only: boolean
  hidden: boolean
  in_list_view: boolean
  permlevel: number
}

export interface DocTypeMeta {
  name: string
  module: string
  issingle: boolean
  istable: boolean
  is_submittable: boolean
  autoname: string
  title_field: string | null
  sort_field: string
  sort_order: string
  track_changes: boolean
  description: string | null
  custom: boolean
  fields: DocField[]
}

// META-011: per-process meta cache. Loads hit the DB once per DocType;
// any metadata mutation must call invalidateMeta().
const cache = new Map<string, DocTypeMeta>()
export const metaCacheStats = { loads: 0, hits: 0 }

// API-00x (#56): slug → DocType name map, so /api/resource/report-feedback
// reaches "Report Feedback" without %20. Lives and dies with the meta cache.
let slugCache: Map<string, string[]> | null = null

export function invalidateMeta(name?: string) {
  if (name) cache.delete(name)
  else cache.clear()
  slugCache = null
}

// CUST-002: coerce a Property Setter's string value to the property's type.
const BOOLEAN_PROPS = new Set(['hidden', 'reqd', 'read_only', 'in_list_view', 'unique'])
function coerceProperty(property: string, value: unknown): unknown {
  if (BOOLEAN_PROPS.has(property)) return value === true || value === '1' || value === 'true'
  return value
}

let propertySetterTableExists: boolean | null = null
async function applyPropertySetters(name: string, meta: DocTypeMeta): Promise<void> {
  if (propertySetterTableExists === null) {
    const [row] = await sql`
      select 1 as ok from information_schema.tables where table_name = 'tab_property_setter'`
    propertySetterTableExists = Boolean(row)
  }
  if (!propertySetterTableExists) return
  const setters = await sql<{ field_name: string | null; property: string; value: string }[]>`
    select field_name, property, value from tab_property_setter where doc_type = ${name}`
  for (const ps of setters) {
    const val = coerceProperty(ps.property, ps.value)
    if (ps.field_name) {
      const f = meta.fields.find((x) => x.fieldname === ps.field_name)
      if (f) (f as unknown as Record<string, unknown>)[ps.property] = val
    } else {
      ;(meta as unknown as Record<string, unknown>)[ps.property] = val
    }
  }
}

// The slug normal form: case-insensitive, with runs of spaces, hyphens and
// underscores collapsed to one space. "Report Feedback", "report-feedback"
// and "report_feedback" all normalize to "report feedback".
function slugify(name: string): string {
  return name.toLowerCase().replace(/[-_\s]+/g, ' ').trim()
}

// #56: resolve a URL spelling of a DocType name. The exact name always wins —
// the slug is an additional accepted spelling, never a replacement (Frappe
// wire compatibility keeps spaces legal in names). An unknown input returns
// unchanged so the caller raises its usual NotFound; a slug matching two
// DocTypes is an error, never a silent pick.
export async function resolveDoctypeName(input: string): Promise<string> {
  if (cache.has(input)) return input
  const [exact] = await sql`select 1 from tab_doctype where name = ${input}`
  if (exact) return input
  if (!slugCache) {
    const rows = await sql`select name from tab_doctype`
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
      `Ambiguous DocType slug ${input}: matches ${matches.join(', ')} — use the exact name`,
    )
  return matches[0] ?? input
}

export async function getMeta(name: string): Promise<DocTypeMeta> {
  const cached = cache.get(name)
  if (cached) {
    metaCacheStats.hits++
    return cached
  }
  const [dt] = await sql`select * from tab_doctype where name = ${name}`
  if (!dt) throw new AppError('NotFoundError', `DocType ${name} not found`)
  const fields = await sql<DocField[]>`
    select * from tab_docfield where parent = ${name} order by idx, fieldname`
  const meta = { ...(dt as unknown as Omit<DocTypeMeta, 'fields'>), fields }

  // CUST-002: overlay Property Setters onto the effective meta. The base
  // rows are never mutated — the override lives only in the loaded object.
  // (Guarded: the table doesn't exist yet during early bootstrap migrations.)
  await applyPropertySetters(name, meta)

  metaCacheStats.loads++
  cache.set(name, meta)
  return meta
}
