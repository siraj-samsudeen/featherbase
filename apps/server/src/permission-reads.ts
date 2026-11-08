import { AsyncLocalStorage } from 'node:async_hooks'
import { hasControllers } from './controllers'
import type { TableMeta } from './meta'

// #1042: a pass over many rows (an import) asks the same questions once per
// row: the person's roles and grants, the Table's access policy and data
// scopes, and (#1074) its active workflow, row scripts, email rules, webhooks
// and the definitions its links point at. Inside `withStablePermissionReads`
// each such query runs once and its rows are reused. Only work whose own
// writes cannot change those answers may use it: work that writes nothing,
// or rows saved into a Table that `writesNoRememberedFacts` accepts.
const remembered = new AsyncLocalStorage<Map<string, Promise<unknown>>>()

export function withStablePermissionReads<T>(work: () => Promise<T>): Promise<T> {
  return remembered.run(new Map(), work)
}

export function readOnce<T>(key: string, read: () => Promise<T>): Promise<T> {
  const memo = remembered.getStore()
  if (!memo) return read()
  let hit = memo.get(key) as Promise<T> | undefined
  if (!hit) {
    hit = read()
    memo.set(key, hit)
    // A failed read is not remembered: the next caller asks again.
    hit.catch(() => memo.delete(key))
  }
  return hit
}

/** #1074: saving rows into this Table changes none of the remembered facts.
 *  A platform Table (roles, grants, workflows, scripts...) or an app's Table
 *  can, through its own rows or its controller's hooks; a Table someone made
 *  runs only the generic lifecycle, which writes none of them. */
export function writesNoRememberedFacts(meta: TableMeta): boolean {
  return !meta.system && !meta.owner_app && !hasControllers(meta.name)
}
