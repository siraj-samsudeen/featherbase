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
 * transaction the effects keep waiting for the outer commit instead.
 *
 * Without this, a document hook's afterDocumentCommit ran at once, inside the
 * still-open transaction: a mention's realtime event reached the recipient
 * before the Notification Log row was committed, so the unread count the
 * event triggered could read 0 and the badge never came.
 */
export async function afterCommitOf<T>(commit: () => Promise<T>): Promise<T> {
  if (effects.getStore()) return await commit()
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
