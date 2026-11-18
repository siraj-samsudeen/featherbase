import type { AreaAxis, AreaRow } from '@featherbase/shop-floor'
import { APP_VERSION_HEADERS } from './api'

// #1282 G1–G6: Dash's areas for the shared area picker, on a staff screen (so a Site
// reads "Store", G6). Each column is the platform's own list read, as the person
// may see it, and each count under a row is how many rows of the next level they
// may see under it, never the Table's total.

interface LevelSpec {
  /** The column people read the row by: a name, never a code. */
  title: string
  /** The link to the level above. */
  parent?: string
  /** Rows the level offers at all: a Site that is a store. */
  filters?: [string, string, unknown][]
}

const LEVELS: Record<string, LevelSpec> = {
  Cluster: { title: 'name' },
  Site: { title: 'name', parent: 'cluster', filters: [['is_store', '=', 1]] },
  'Store Floor': { title: 'name', parent: 'site' },
  Division: { title: 'division' },
  Subdivision: { title: 'subdivision', parent: 'division' },
  Category: { title: 'category', parent: 'subdivision' },
  Subcategory: { title: 'subcategory', parent: 'category' },
}

export const DASH_AREAS: AreaAxis[] = [
  {
    name: 'Location', whole: 'Whole company',
    levels: [
      { table: 'Cluster', label: 'Cluster', plural: 'clusters' },
      { table: 'Site', label: 'Store', plural: 'stores' },
      { table: 'Store Floor', label: 'Floor', plural: 'floors' },
    ],
  },
  {
    name: 'Merchandise', whole: 'All merchandise',
    levels: [
      { table: 'Division', label: 'Division', plural: 'divisions' },
      { table: 'Subdivision', label: 'Subdivision', plural: 'subdivisions' },
      { table: 'Category', label: 'Category', plural: 'categories' },
      { table: 'Subcategory', label: 'Subcategory', plural: 'subcategories' },
    ],
  },
]

/** The most rows one column lists. */
const COLUMN_ROWS = 500

async function list(table: string, filters: unknown[], fields: string[], limit: number, orderBy?: string): Promise<{ data: Record<string, unknown>[]; total: number }> {
  const query = new URLSearchParams({ filters: JSON.stringify(filters), fields: JSON.stringify(fields), limit_page_length: String(limit) })
  if (orderBy) query.set('order_by', orderBy)
  const response = await fetch(`/api/table/${encodeURIComponent(table)}?${query}`, { credentials: 'same-origin', headers: APP_VERSION_HEADERS })
  if (!response.ok) throw new Error(`The ${table} list could not be read`)
  return response.json() as Promise<{ data: Record<string, unknown>[]; total: number }>
}

const narrowed = (spec: LevelSpec, parent: string | null) => [...(spec.filters ?? []), ...(parent && spec.parent ? [[spec.parent, '=', parent]] : [])]

/** A column of the picker: the level's rows under the row picked before it, each with how many of the next level it holds. */
export async function loadDashArea(axis: AreaAxis, level: number, parent: AreaRow | null): Promise<AreaRow[]> {
  const here = LEVELS[axis.levels[level]!.table]!
  const { data } = await list(axis.levels[level]!.table, narrowed(here, parent?.id ?? null), ['row_id', here.title], COLUMN_ROWS, `${here.title} asc`)
  const next = axis.levels[level + 1]
  return Promise.all(data.map(async (row) => {
    const id = String(row.row_id)
    const name = String(row[here.title] ?? '').trim() || id
    if (!next) return { id, name }
    const { total } = await list(next.table, narrowed(LEVELS[next.table]!, id), ['row_id'], 1)
    return { id, name, count: total }
  }))
}
