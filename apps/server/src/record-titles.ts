import { sql } from './db'
import { scopedWhere } from './query'

// #1345 (Codex adversarial round 1): a record a viewer is told about by name is
// named by its own title, read as that viewer: never by words someone else
// supplied (an app's answer), and never where the viewer may not read the row or
// its title. Shared by the Person Label and the Person page's standing.

export type RecordRef = { table: string; row_id: string }
export const recordKey = (r: RecordRef) => `${r.table}\u0000${r.row_id}`

/** Each record's title as `viewer` may read it, keyed by recordKey; a record they may not read, or whose
 *  title they may not read, is left out. A Table with no title column names its rows by their keys. */
export async function readableTitles(refs: RecordRef[], viewer: string): Promise<Map<string, string>> {
  const byTable = new Map<string, Set<string>>()
  for (const r of refs) byTable.set(r.table, (byTable.get(r.table) ?? new Set()).add(r.row_id))
  const titles = new Map<string, string>()
  await Promise.all([...byTable].map(async ([table, rowIds]) => {
    const scoped = await scopedWhere(table, viewer, []).catch(() => null)
    if (!scoped) return
    const { meta, table: physical, where, cols, readExpression } = scoped
    // A title column the viewer may not read names nothing.
    if (meta.title_column && !cols.has(meta.title_column)) return
    const rowKey = sql(meta.row_key)
    const shown = meta.title_column ? readExpression(meta.title_column) : rowKey
    const rows = await sql`select ${rowKey}::text as id, ${shown}::text as title from ${sql(physical)}
      where ${where} and ${rowKey}::text = any(${[...rowIds]})`
    for (const r of rows) {
      const words = String(r.title ?? '').trim()
      if (words) titles.set(recordKey({ table, row_id: String(r.id) }), words)
    }
  }))
  return titles
}
