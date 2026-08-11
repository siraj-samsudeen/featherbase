import { sql } from './db'
import { getMeta } from './meta'
import { hasPermission } from './permissions'
import { tableName } from './doctype-engine'

// UI-014: awesomebar global search. Matches row names (and the
// Table's title_column) across every regular Table the user can read.
// Results are capped small — this powers a typeahead, not a report.

export interface SearchHit {
  table: string
  row_id: string
  title: string
}

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

  const hits: SearchHit[] = []
  for (const t of tables) {
    if (hits.length >= TOTAL_CAP) break
    if (!(await hasPermission(user, t.name as string, 'read'))) continue
    const meta = await getMeta(t.name as string)
    const title = meta.title_column
    const rows = title
      ? await sql`
          select row_id, ${sql(title)} as title from ${sql(tableName(meta.name))}
          where row_id ilike ${like} or ${sql(title)} ilike ${like}
          limit ${PER_TABLE}`
      : await sql`
          select row_id, row_id as title from ${sql(tableName(meta.name))}
          where row_id ilike ${like}
          limit ${PER_TABLE}`
    for (const row of rows) {
      hits.push({
        table: meta.name,
        row_id: String(row.row_id),
        title: String(row.title ?? row.row_id),
      })
      if (hits.length >= TOTAL_CAP) break
    }
  }
  return hits
}
