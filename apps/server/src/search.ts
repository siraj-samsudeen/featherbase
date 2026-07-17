import { sql } from './db'
import { getMeta } from './meta'
import { hasPermission } from './permissions'

// UI-014: awesomebar global search. Matches document names (and the
// DocType's title_field) across every regular DocType the user can read.
// Results are capped small — this powers a typeahead, not a report.

export interface SearchHit {
  doctype: string
  name: string
  title: string
}

const PER_DOCTYPE = 3
const TOTAL_CAP = 15

function tableName(doctype: string): string {
  return 'tab_' + doctype.toLowerCase().replace(/\s+/g, '_')
}

export async function globalSearch(query: string, user: string): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []
  const like = '%' + q.replace(/[\\%_]/g, (c) => `\\${c}`) + '%'

  const doctypes = await sql`
    select name from tab_doctype where not istable and not issingle order by name`

  const hits: SearchHit[] = []
  for (const dt of doctypes) {
    if (hits.length >= TOTAL_CAP) break
    if (!(await hasPermission(user, dt.name as string, 'read'))) continue
    const meta = await getMeta(dt.name as string)
    const title = meta.title_field
    const rows = title
      ? await sql`
          select name, ${sql(title)} as title from ${sql(tableName(meta.name))}
          where name ilike ${like} or ${sql(title)} ilike ${like}
          limit ${PER_DOCTYPE}`
      : await sql`
          select name, name as title from ${sql(tableName(meta.name))}
          where name ilike ${like}
          limit ${PER_DOCTYPE}`
    for (const row of rows) {
      hits.push({
        doctype: meta.name,
        name: String(row.name),
        title: String(row.title ?? row.name),
      })
      if (hits.length >= TOTAL_CAP) break
    }
  }
  return hits
}
