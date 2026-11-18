import type { AreaAxis, AreaRow } from '@featherbase/shop-floor'
import manifest from '../featherbase.json' with { type: 'json' }
import { APP_VERSION_HEADERS } from './api'
import { SITE_KIND_FIELDS, openStore } from './site-kind'

// #1282 G1–G6: Dash's areas for the shared area picker, on a staff screen (so a Site
// reads "Store", G6). The hierarchy is the one featherbase.json declares, the Admin's
// picker reads too (Codex standard round 2: one home). Each column is the platform's own
// list read, as the person may see it, and each count under a row is how many rows of the
// next level they may see under it, never the Table's total.

interface DeclaredLevel { table: string; title: string; parent?: string; label: string; plural: string; filters?: [string, string, unknown][] }
const DECLARED = (manifest as unknown as { areas: { name: string; whole: string; levels: DeclaredLevel[] }[] }).areas
const LEVELS = new Map(DECLARED.flatMap(area => area.levels.map(level => [level.table, level] as const)))

/** Dash's one adaptation: a Site is offered when it is an open store by the server's own rule (openStore), which
 *  reads site_kind and status where the instance has them; the declaration's is_store filter cannot say that. */
const STORES = 'Site'

export const DASH_AREAS: AreaAxis[] = DECLARED.map(area => ({
  name: area.name, whole: area.whole,
  levels: area.levels.map(({ table, label, plural }) => ({ table, label, plural })),
}))

/** The most rows one column lists. */
const COLUMN_ROWS = 500
/** The most Sites one count reads: a cluster holds far fewer. */
const SITE_ROWS = 2000

async function list(table: string, filters: unknown[], fields: string[], limit: number, orderBy?: string): Promise<{ data: Record<string, unknown>[]; total: number }> {
  const query = new URLSearchParams({ filters: JSON.stringify(filters), fields: JSON.stringify(fields), limit_page_length: String(limit) })
  if (orderBy) query.set('order_by', orderBy)
  const response = await fetch(`/api/table/${encodeURIComponent(table)}?${query}`, { credentials: 'same-origin', headers: APP_VERSION_HEADERS })
  if (!response.ok) throw new Error(`The ${table} list could not be read`)
  return response.json() as Promise<{ data: Record<string, unknown>[]; total: number }>
}

/** The Site columns openStore reads that this viewer may read here (an instance may not have site_kind or status). */
let storeColumns: Promise<string[]> | undefined
function storeFields(): Promise<string[]> {
  storeColumns ??= fetch(`/api/table/${STORES}:meta`, { credentials: 'same-origin', headers: APP_VERSION_HEADERS })
    .then(r => (r.ok ? r.json() as Promise<{ readable_columns?: string[] }> : {}))
    .then(meta => ['is_store', ...SITE_KIND_FIELDS].filter(c => (meta as { readable_columns?: string[] }).readable_columns?.includes(c)), () => [])
  return storeColumns
}

/** A level's rows under a parent; for Site only the open stores, as the server's Correct and Also Give check them (Codex standard round 1). */
async function rowsOf(table: string, parent: string | null, fields: string[], limit: number, orderBy?: string) {
  const level = LEVELS.get(table)!
  const under = parent && level.parent ? [[level.parent, '=', parent]] : []
  if (table !== STORES) return list(table, [...level.filters ?? [], ...under], fields, limit, orderBy)
  const { data } = await list(table, under, [...new Set([...fields, ...await storeFields()])], SITE_ROWS, orderBy)
  const open = data.filter(openStore)
  return { data: open.slice(0, limit), total: open.length }
}

/** A column of the picker: the level's rows under the row picked before it, each with how many of the next level it holds.
 *  A count the viewer may not read is left off, and its row stays to pick (Codex standard round 2). */
export async function loadDashArea(axis: AreaAxis, level: number, parent: AreaRow | null): Promise<AreaRow[]> {
  const table = axis.levels[level]!.table
  const here = LEVELS.get(table)!
  const { data } = await rowsOf(table, parent?.id ?? null, ['row_id', here.title], COLUMN_ROWS, `${here.title} asc`)
  const next = axis.levels[level + 1]
  return Promise.all(data.map(async (row) => {
    const id = String(row.row_id)
    const name = String(row[here.title] ?? '').trim() || id
    if (!next) return { id, name }
    const total = await rowsOf(next.table, id, ['row_id'], 1).then(r => r.total, () => undefined)
    return total === undefined ? { id, name } : { id, name, count: total }
  }))
}

/** For tests: forget the Site columns read for this page. */
export function forgetStoreFields() { storeColumns = undefined }
