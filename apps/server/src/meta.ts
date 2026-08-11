import { sql } from './db'
import { AppError } from './errors'
import { ENGINE_WRITABLE, type SourceEngine } from './sources/types'

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
  row_id: string
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
  // EDS-3: on a source-bound Table, the true column name on the source when
  // it differs from column_name (reserved/illegal names). Null = same name.
  source_column: string | null
}

// #132: the row key. Every generated table's primary key is the physical
// column `row_id` — the "Row ID" the product has spoken about since the
// vocabulary rename — and `row_id` is what every API response and request
// carries. `name` is no longer reserved, so a user Table may finally have a
// plain `name` column (Student.name, Customer.name).
export const ROW_KEY = 'row_id'

// The ONE table whose primary key is not the physical `row_id`: `table_def`
// keeps `name`, because there the key is a NATURAL one — it holds the Table's
// own identifier ('Student'), it is the target of a real foreign key
// (`column_def.parent references table_def(name)`), and Table names are what
// `reference_table`, `row_table`, `parenttype`, `permission.table` and the
// whole metadata layer point at. That identifier is a different concept from a
// row id and is deliberately out of scope for #132.
//
// This exception is PHYSICAL ONLY. Every API response still carries the key as
// `row_id`, so nothing above the SQL layer — the Desk included — has to know.
const PHYSICAL_ROW_KEY_OVERRIDES: Record<string, string> = { Table: 'name' }

export function physicalRowKey(table: string): string {
  return PHYSICAL_ROW_KEY_OVERRIDES[table] ?? ROW_KEY
}

export interface TableMeta {
  name: string
  // Physical primary-key column of this Table's storage — `row_id` for every
  // Table but `Table` itself (see physicalRowKey). SQL construction uses this;
  // the wire format is always `row_id`.
  row_key: string
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
  // #74: true for platform tables created by the migration chain. The Admin
  // sidebar groups (never hides) these; POST/PUT /api/doctype reject it.
  system: boolean
  // EDS-3: set when this Table is bound to an external Data Source. A bound
  // Table has no local physical table, no DDL, no RLS; reads and writes
  // dispatch through sources/ (see sources/dispatch.ts).
  data_source: string | null
  external_schema: string | null
  external_table: string | null
  external_pk: string | null
  // Source column used for optimistic locking + the synthesized updated_at.
  external_modified: string | null
  // Enriched from the Data Source row at load time (not stored on table_def)
  // so the Desk can gate its UI; invalidated with the meta cache when a
  // source changes (spec S3).
  source_access?: 'read_only' | 'read_write' | null
  source_engine?: string | null
  // The server-derived truth the Desk gates all write affordances on:
  // engine capability AND access mode (review finding 7 — access alone
  // mislabels a read_write-configured duckdb source as editable).
  source_writable?: boolean
  columns: ColumnDef[]
}

// META-011: per-process meta cache. Loads hit the DB once per Table; any
// metadata mutation must call invalidateMeta().
const cache = new Map<string, TableMeta>()
export const metaCacheStats = { loads: 0, hits: 0 }

// API-00x (#56): slug → Table name map, so /api/table/report-feedback
// reaches "Report Feedback" without %20. Lives and dies with the meta cache.
let slugCache: Map<string, string[]> | null = null

// Relational navigation: reverse-reference map, cached whole (a Reference
// column added to ANY table can change ANY other table's backlinks, so a
// targeted invalidate still clears all of it).
let backlinksCache: Map<string, Backlink[]> | null = null

export function invalidateMeta(name?: string) {
  if (name) cache.delete(name)
  else cache.clear()
  slugCache = null
  backlinksCache = null
}

// A table that points at `target` via a Reference column. When the Reference
// lives in a sub-table, `table` is the OWNING table (the one with a list to
// navigate to) and `via` names the sub-table holding the column — Frappe's
// "internal links" shape (Item is reached from Purchase Order via PO Line).
export interface Backlink {
  table: string
  column: string
  via: string | null
}

export async function getBacklinks(target: string): Promise<Backlink[]> {
  if (!backlinksCache) {
    const targets = await sql<
      { parent: string; column_name: string; reference_table: string; kind: string }[]
    >`
      select cd.parent, cd.column_name, cd.reference_table, td.kind
      from column_def cd join table_def td on td.name = cd.parent
      where cd.column_type = 'Reference' and cd.reference_table is not null`
    // owners of each sub-table: Table rows with a Sub-table column pointing at it
    const owners = await sql<{ parent: string; row_table: string; kind: string }[]>`
      select cd.parent, cd.row_table, td.kind
      from column_def cd join table_def td on td.name = cd.parent
      where cd.column_type = 'Sub-table' and cd.row_table is not null`
    const ownersOf = new Map<string, string[]>()
    for (const o of owners) {
      if (o.kind !== 'table') continue
      const list = ownersOf.get(o.row_table) ?? []
      if (!list.includes(o.parent)) list.push(o.parent)
      ownersOf.set(o.row_table, list)
    }
    const map = new Map<string, Backlink[]>()
    for (const t of targets) {
      if (t.kind === 'settings') continue
      const entries: Backlink[] =
        t.kind === 'sub_table'
          ? (ownersOf.get(t.parent) ?? []).map((owner) => ({
              table: owner,
              column: t.column_name,
              via: t.parent,
            }))
          : [{ table: t.parent, column: t.column_name, via: null }]
      for (const e of entries) {
        const list = map.get(t.reference_table) ?? []
        if (!list.some((x) => x.table === e.table && x.column === e.column && x.via === e.via))
          list.push(e)
        map.set(t.reference_table, list)
      }
    }
    for (const list of map.values())
      list.sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column))
    backlinksCache = map
  }
  return backlinksCache.get(target) ?? []
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
  if (!dt) {
    // DEL-R9 (docs/specs/0003-table-deletion.md): a deleted Table's
    // not-found names the deletion — the Access Log's plain-text testimony
    // (DEL-R8) read back at the miss. A never-created name stays a plain
    // not-found: a tombstone is only ever minted from a real burial.
    // Guarded: a database mid-upgrade may not have access_log yet.
    const [grave] = await sql`
      select "user", created_at from access_log
      where operation = 'delete_table' and ref_table = ${name}
      order by created_at desc limit 1`.catch(() => [])
    if (grave)
      throw new AppError(
        'NotFoundError',
        `Table ${name} was deleted by ${grave.user as string} on ${new Date(
          grave.created_at as string,
        ).toISOString().slice(0, 10)}`,
      )
    throw new AppError('NotFoundError', `Table ${name} not found`)
  }
  const columns = await sql<ColumnDef[]>`
    select * from column_def where parent = ${name} order by position, column_name`
  const meta = {
    ...(dt as unknown as Omit<TableMeta, 'columns' | 'row_key'>),
    row_key: physicalRowKey(name),
    columns,
  }

  // EDS-7/EDS-13: surface the bound source's access mode and engine on the
  // meta the Desk consumes. Loaded here so it caches (and invalidates) with
  // the meta itself; the Data Source controller invalidates on save.
  if (meta.data_source) {
    const [src] = await sql`
      select access, engine from data_source where row_id = ${meta.data_source}`
    meta.source_access = (src?.access as 'read_only' | 'read_write' | undefined) ?? 'read_only'
    meta.source_engine = (src?.engine as string | undefined) ?? null
    meta.source_writable =
      meta.source_access === 'read_write' &&
      (ENGINE_WRITABLE[meta.source_engine as SourceEngine] ?? false)
  }

  // CUST-002: overlay Metadata Overrides onto the effective meta. The base
  // rows are never mutated — the override lives only in the loaded object.
  // (Guarded: the table doesn't exist yet during early bootstrap migrations.)
  await applyMetadataOverrides(name, meta)

  metaCacheStats.loads++
  cache.set(name, meta)
  return meta
}
