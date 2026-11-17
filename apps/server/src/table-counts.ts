// admin-lists 11 (17-Nov-2026): All Tables shows how many rows each Table
// holds, for whoever manages the instance. Every count goes through the
// viewer's own scopedWhere, never an unscoped estimate: managers do not
// bypass creator privacy (mandatory-access.ts), so a Table's population is
// not theirs to see (Codex review). Every count is exact; one that takes
// longer than COUNT_MS is left out rather than hold up the page.
// Outside sources, views, sub-tables and settings have no count.
import { sql } from './db'
import { AppError } from './errors'
import { getRoles } from './permissions'
import { scopedWhere } from './query'

/** The longest one Table's count may take before it is left out. */
export const COUNT_MS = 2_000
/** How many Tables are counted at once. */
const AT_ONCE = 6

export async function tableRowCounts(user: string): Promise<Record<string, number>> {
  const manager = user === 'Administrator' || (await getRoles(user)).includes('System Manager')
  if (!manager) return {}
  const tables = await sql`
    select name, owner_app from table_def
    where kind = 'table' and data_source is null and archived_at is null
    order by name`
  const counts: Record<string, number> = {}
  const queue = [...tables]
  async function worker() {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const count = await countOne(String(t.name), user, t.owner_app != null)
      if (count !== null) counts[String(t.name)] = count
    }
  }
  await Promise.all(Array.from({ length: AT_ONCE }, worker))
  return counts
}

async function countOne(name: string, user: string, ofApp: boolean): Promise<number | null> {
  // A Table this viewer may not read (an access policy they are not admitted
  // to) has no count; an app that is off or awaiting activation answers
  // nothing, as in search (#648). Anything else is a real failure.
  const scoped = await scopedWhere(name, user, []).catch((error: unknown) => {
    if (error instanceof AppError && (error.type === 'PermissionError' || (ofApp && error.type === 'ConflictError'))) return null
    throw error
  })
  if (!scoped) return null
  const { table, where } = scoped
  const counted = await withinTime<{ rows: string }[]>(
    sql`select count(*)::bigint as rows from ${sql(table)} where ${where}`,
    COUNT_MS,
  )
  return counted ? Number(counted[0].rows) : null
}

/** A query's answer, or null once it has run `ms` and Postgres has cancelled
 *  it (57014). Any other failure is a real one. */
export async function withinTime<T>(query: PromiseLike<T> & { cancel(): unknown }, ms: number): Promise<T | null> {
  const timer = setTimeout(() => void query.cancel(), ms)
  try {
    return await query
  } catch (error) {
    if ((error as { code?: string })?.code === '57014') return null
    throw error
  } finally {
    clearTimeout(timer)
  }
}
