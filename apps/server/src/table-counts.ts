// admin-lists 11 (17-Nov-2026): All Tables shows how many rows each Table
// holds. Exact where that is cheap (a small Table, or one Postgres has never
// analysed), Postgres's estimate where a count would scan a big Table. Only
// for whoever manages the instance: they read every row, so an unscoped
// estimate tells them nothing they may not see. Outside sources, views,
// sub-tables and settings have no count here.
import { sql } from './db'
import { AppError } from './errors'
import { getRoles } from './permissions'
import { scopedWhere } from './query'

/** Below this estimate a Table is counted exactly. */
export const EXACT_BELOW = 10_000
/** How many Tables are counted at once. */
const AT_ONCE = 6

export interface RowCount {
  rows: number
  exact: boolean
}

export async function tableRowCounts(user: string): Promise<Record<string, RowCount>> {
  const manager = user === 'Administrator' || (await getRoles(user)).includes('System Manager')
  if (!manager) return {}
  const tables = await sql`
    select name, owner_app from table_def
    where kind = 'table' and data_source is null and archived_at is null
    order by name`
  const counts: Record<string, RowCount> = {}
  const queue = [...tables]
  async function worker() {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const count = await countOne(String(t.name), user, t.owner_app != null)
      if (count) counts[String(t.name)] = count
    }
  }
  await Promise.all(Array.from({ length: AT_ONCE }, worker))
  return counts
}

async function countOne(name: string, user: string, ofApp: boolean): Promise<RowCount | null> {
  // An app that is off or awaiting activation answers nothing, as in search (#648).
  const scoped = await scopedWhere(name, user, []).catch((error: unknown) => {
    if (ofApp && error instanceof AppError && (error.type === 'PermissionError' || error.type === 'ConflictError')) return null
    throw error
  })
  if (!scoped) return null
  const { table, where } = scoped
  const [estimate] = await sql`select reltuples::bigint as rows from pg_class where oid = to_regclass(${table})`
  const guess = estimate ? Number(estimate.rows) : -1
  if (guess >= EXACT_BELOW) return { rows: guess, exact: false }
  const [exact] = await sql`select count(*)::bigint as rows from ${sql(table)} where ${where}`
  return { rows: Number(exact.rows), exact: true }
}
