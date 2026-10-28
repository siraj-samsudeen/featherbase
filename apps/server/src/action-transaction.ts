import { AsyncLocalStorage } from 'node:async_hooks'
import { withTransaction } from './db'

const effects = new AsyncLocalStorage<(() => Promise<void>)[]>()

export async function afterDocumentCommit(effect: () => Promise<void>): Promise<void> {
  const pending = effects.getStore()
  if (pending) pending.push(effect)
  else await effect()
}

export async function actionTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return await afterCommitOf(() => withTransaction(fn))
}

/**
 * Run `commit` — a call that opens AND commits a transaction — so that every
 * effect registered inside it waits for that commit (#426). Inside an action
 * transaction the effects keep waiting for the outer commit instead, and are
 * dropped if their own nested commit fails.
 *
 * Without this, a document hook's afterDocumentCommit ran at once, inside the
 * still-open transaction: a mention's realtime event reached the recipient
 * before the Notification Log row was committed, so the unread count the
 * event triggered could read 0 and the badge never came.
 */
export async function afterCommitOf<T>(commit: () => Promise<T>): Promise<T> {
  const outer = effects.getStore()
  if (outer) {
    // A nested commit is a savepoint. If it rolls back while the outer
    // transaction carries on (#686: one refused import row), its effects
    // describe writes that never happened, so they are dropped with it.
    const inner: (() => Promise<void>)[] = []
    const result = await effects.run(inner, commit)
    outer.push(...inner)
    return result
  }
  const pending: (() => Promise<void>)[] = []
  const result = await effects.run(pending, commit)
  // Deliberately outside both async-local scopes: nested effect writes use
  // fresh transactions and their normal post-commit semantics.
  for (const effect of pending) {
    try { await effect() }
    catch (error) { console.error('Runtime action post-commit effect failed', error) }
  }
  return result
}
