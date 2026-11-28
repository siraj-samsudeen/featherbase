// Who reads which rows (#1454, rama_dw #4935): exactly as Dash. The instance's org-chart scope provider (Dash's) gives
// each person their places, a store whole or some subcategory codes at a store, and the platform reads the copies and
// the review Tables only within them (section staff their section, a Team Leader theirs, a Store Manager the store, a
// category head their subcategories at their region's stores). No places, no access: the platform refuses the read.
import manifest from '../featherbase.json'

type Row = Record<string, unknown>
export interface Place { label: string; filters: Record<string, readonly string[]>; basis?: string }

/** The reader's places; none refuses the read (the platform already refuses an empty scope; this is the same rule
 *  again, beside the rows it keeps). */
/** What a reader with no places is told; the page knows it by these words. */
export const NO_PLACES = 'You have no store, section or subcategory on the org chart'
export function placesOf(places: readonly Place[] | undefined, reject: (message: string) => never): readonly Place[] {
  if (!places?.length) reject(NO_PLACES)
  return places
}

/** The stock copy any reader may ask about other stores (Siraj, 28-Nov-2026: a transfer needs to see who holds an
 *  item); it is read only for named items or subcategories, never a whole store's list. */
export const STOCK_ELSEWHERE = 'item_stock'
const NARROWED_BY = ['item_code', 'subcategory_code']

/** Whether a row is inside one of the places, by a filter → column mapping: every filter a place names must be mapped
 *  and hold, as the platform reads them (a filter the mapping lacks would widen the place, so the place adds nothing). */
export function inPlaces(row: Row, places: readonly Place[], mapping: Readonly<Record<string, string>>): boolean {
  return places.some(place => Object.entries(place.filters).every(([filter, values]) =>
    Object.hasOwn(mapping, filter) && row[mapping[filter]] != null && values.includes(String(row[mapping[filter]]))))
}

interface Copy { name: string; rowKey?: string[]; filters?: Record<string, string>; unscoped?: boolean; columns: { name: string }[] }
/** The read-only copies, as the manifest declares them. */
export const COPIES: ReadonlyMap<string, Copy> = new Map((manifest.datasets as Copy[]).map(d => [d.name, d]))

/** A copy row's id, as the platform keys it: its row key's values joined by "·" (read-only-copy.ts), so a page can
 *  link the row and name it in a review. */
export const ROW_KEY_JOIN = '·'
export function copyRowId(copy: Copy, row: Row): string | null {
  const values = (copy.rowKey ?? []).map(k => row[k])
  return values.some(v => v == null || v === '') ? null : values.map(String).join(ROW_KEY_JOIN)
}

/** The review Tables a scoped read lists, and how each maps the places (manifest `scopedTables`). */
export const REVIEW_TABLES: ReadonlyMap<string, Record<string, string>> = new Map(
  ((manifest as { scopedTables?: { table: string; filters: Record<string, string> }[] }).scopedTables ?? []).map(t => [t.table, t.filters]))

/** Only the fields asked for (and row_id), or the whole row. */
export function pick(row: Row, fields: unknown): Row {
  if (!Array.isArray(fields)) return row
  const out: Row = { row_id: row.row_id }
  for (const f of fields) if (typeof f === 'string' && f in row) out[f] = row[f]
  return out
}

interface DatasetAnswer { at: string; rows: Row[] }
export interface ScopedReadContext {
  payload: unknown
  authorization: { places?: readonly Place[] }
  datasets: { active(name: string, filters?: unknown): Promise<DatasetAnswer | null> }
  scopedTables: { list(table: string, filters?: unknown, options?: { fields?: string[] }): Promise<Row[]> }
  recordView(details?: { dataset?: string }): Promise<void>
  reject(message: string): never
}

/** `copy`: one read-only copy's rows inside the reader's places, filtered on its declared keys; `at` is when its
 *  load was made, null when none is loaded yet. */
export async function readCopy(ctx: ScopedReadContext): Promise<{ at: string | null; rows: Row[] }> {
  const { dataset, filters, fields } = (ctx.payload ?? {}) as { dataset?: unknown; filters?: unknown; fields?: unknown }
  const copy = typeof dataset === 'string' ? COPIES.get(dataset) : undefined
  if (!copy) ctx.reject(`Forecasting has no copy ${String(dataset)}`)
  const places = placesOf(ctx.authorization.places, ctx.reject)
  if (copy.name === STOCK_ELSEWHERE && !NARROWED_BY.some(k => Array.isArray((filters as Record<string, unknown> | undefined)?.[k]) || typeof (filters as Record<string, unknown> | undefined)?.[k] === 'string'))
    ctx.reject('Name the items or subcategories whose stock elsewhere you need')
  const answer = await ctx.datasets.active(copy.name, filters)
  await ctx.recordView({ dataset: copy.name })
  if (!answer) return { at: null, rows: [] }
  // the platform has held the rows to the reader's places; the same rule again here
  const rows = copy.unscoped ? answer.rows : answer.rows.filter(r => inPlaces(r, places, copy.filters ?? {}))
  return { at: answer.at, rows: rows.map(r => pick({ ...r, row_id: copyRowId(copy, r) }, fields)) }
}

/** `review`: rows of one review Table (answers, changes, questions, day explanations) inside the reader's places. */
export async function readReview(ctx: ScopedReadContext): Promise<Row[]> {
  const { table, filters, fields } = (ctx.payload ?? {}) as { table?: unknown; filters?: unknown; fields?: unknown }
  const mapping = typeof table === 'string' ? REVIEW_TABLES.get(table) : undefined
  if (!mapping) ctx.reject(`Forecasting has no review Table ${String(table)}`)
  const places = placesOf(ctx.authorization.places, ctx.reject)
  // the place columns are read too, so the places can be checked again; then only what was asked for is answered
  const asked = Array.isArray(fields) ? [...new Set([...fields.filter((f): f is string => typeof f === 'string'), ...Object.values(mapping)])] : undefined
  const rows = await ctx.scopedTables.list(table as string, filters, asked ? { fields: asked } : {})
  return rows.filter(r => inPlaces(r, places, mapping)).map(r => (Array.isArray(fields) ? pick(r, [...fields, 'updated_at']) : r))
}
