import { sql } from './db'
import { hasPermission } from './permissions'
import { scopedWhere } from './query'

// UI-014: awesomebar global search. Matches row names (and the
// Table's title_column) across every regular Table the user can read.
// Results are capped small — this powers a typeahead, not a report.

export interface SearchHit {
  table: string
  row_id: string
  title: string
  /** Set only for system-registry rows: what the row IS, not where it lives. */
  kind_label?: string
}

// #431: rows of these engine registries describe structure, not business data.
// Without a label, "Activity Log · row in Table" read like a duplicate of the
// Tables entry for Activity Log. They also rank after ordinary records.
export const REGISTRY_LABELS: Record<string, string> = {
  Table: 'Table definition',
  Column: 'Column definition',
  'Custom Field': 'Custom field definition',
  Permission: 'Permission rule',
  'Data Scope': 'Data scope rule',
  'Metadata Override': 'Metadata override',
}

// Own keys only: a user Table named `constructor` is not a registry.
export const registryLabel = (name: string): string | undefined =>
  Object.hasOwn(REGISTRY_LABELS, name) ? REGISTRY_LABELS[name] : undefined

const PER_TABLE = 3
const TOTAL_CAP = 15

export async function globalSearch(query: string, user: string): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []
  const like = '%' + q.replace(/[\\%_]/g, (c) => `\\${c}`) + '%'

  // Source-bound Tables are excluded: they have no physical table here (the
  // old query 500'd the whole search the moment one existed), and fanning a
  // per-keystroke ilike out to every foreign store is not a typeahead's job.
  const tables = await sql`
    select name from table_def where kind = 'table' and data_source is null
    order by name`
  // Stable sort: ordinary Tables first, registries last (#431).
  const isRegistry = (n: unknown) => (registryLabel(String(n)) ? 1 : 0)
  tables.sort((a, b) => isRegistry(a.name) - isRegistry(b.name))

  const hits: SearchHit[] = []
  for (const t of tables) {
    if (hits.length >= TOTAL_CAP) break
    if (!(await hasPermission(user, t.name as string, 'read'))) continue
    const { meta, table, where, cols } = await scopedWhere(t.name as string, user, [])
    const title = meta.title_column && cols.has(meta.title_column) ? meta.title_column : null
    // The wire key is always `row_id`; `Table` alone stores it as `name`.
    const key = sql(meta.row_key)
    const rows = title
      ? await sql`
          select ${key} as row_id, ${sql(title)} as title from ${sql(table)}
          where ${where} and (${key} ilike ${like} or ${sql(title)} ilike ${like})
          limit ${PER_TABLE}`
      : await sql`
          select ${key} as row_id, ${key} as title from ${sql(table)}
          where ${where} and ${key} ilike ${like}
          limit ${PER_TABLE}`
    for (const row of rows) {
      hits.push({
        table: meta.name,
        row_id: String(row.row_id),
        title: String(row.title ?? row.row_id),
        ...(registryLabel(meta.name) ? { kind_label: registryLabel(meta.name) } : {}),
      })
      if (hits.length >= TOTAL_CAP) break
    }
  }
  return hits
}
