import { sql } from './db'
import { PLATFORM_SCHEMA } from './platform-schema'

// Early bootstrap migrations already save rows, before every platform Table
// exists, so the lifecycle asks "does server_script exist yet?" on every save
// (#1074: seven times a row). A platform Table is never dropped once made, so
// only the positive answer is remembered, as hasWorkflowSchema does; a
// migration that creates the Table later in the process is still seen.
const present = new Set<string>()

// `db` is the caller's transaction connection when it holds one (see
// runDocEventScripts): the global pool could deadlock under concurrent saves.
export async function platformTableExists(table: string, db: typeof sql = sql): Promise<boolean> {
  if (present.has(table)) return true
  const [row] = await db`
    select 1 from information_schema.tables where table_schema = ${PLATFORM_SCHEMA} and table_name = ${table}`
  if (row) present.add(table)
  return Boolean(row)
}
