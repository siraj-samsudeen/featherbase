// #693: the locks a write takes BEFORE it locks a row, in one fixed order, so
// no two write paths can deadlock by taking them the other way round.
import type { sql } from './db'
import { runHooks } from './controllers'
import { holdManagedSet } from './managed-settings'
import type { TableMeta } from './meta'

/** The managed-settings hold, then the Table's before_lock hooks (the Sign In
 *  Method controller takes the ways-in lock there). saveDoc and deleteDoc take
 *  them first; any other path that locks a row and then saves or deletes it
 *  calls this first too. Both are re-entrant within a transaction. */
export async function holdBeforeRowLock(
  db: typeof sql,
  meta: TableMeta,
  user: string,
  row: Record<string, unknown>,
  isNew = false,
): Promise<void> {
  await holdManagedSet(db, meta.name)
  await runHooks('before_lock', { row, meta, user, isNew, tx: db })
}
