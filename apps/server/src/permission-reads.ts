import { AsyncLocalStorage } from 'node:async_hooks'

// #1042: a read-only pass over many rows (import key analysis) asks the same
// person-and-Table permission questions once per row: roles, grants, the
// Table's access policy, data scopes. Inside `withStablePermissionReads`
// each such query runs once and its rows are reused. Only work that writes
// nothing may use it: a write in the scope could change the answer.
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
