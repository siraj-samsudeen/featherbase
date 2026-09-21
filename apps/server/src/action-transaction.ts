import { AsyncLocalStorage } from 'node:async_hooks'
import { withTransaction } from './db'

const effects = new AsyncLocalStorage<(() => Promise<void>)[]>()

// @spec action_commit_boundary_and_lifecycle_serialize
export async function afterDocumentCommit(effect: () => Promise<void>): Promise<void> {
  const pending = effects.getStore()
  if (pending) pending.push(effect)
  else await effect()
}

export async function actionTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const pending: (() => Promise<void>)[] = []
  const result = await effects.run(pending, () => withTransaction(fn))
  // Deliberately outside both async-local scopes: nested effect writes use
  // fresh transactions and their normal post-commit semantics.
  for (const effect of pending) {
    try { await effect() }
    catch (error) { console.error('Runtime action post-commit effect failed', error) }
  }
  return result
}
