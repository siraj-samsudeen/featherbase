// #1222: whether the request in hand runs as someone a tester is viewing as.
// Set once per request by the auth middleware (index.ts), for a read only, so
// what runs deep inside it (permissions, the Access Log) can tell
// without every caller threading it. Like session-context.ts, and kept as
// small, so any module can import it without a cycle.
import { AsyncLocalStorage } from 'node:async_hooks'

export interface ViewingAs {
  /** The person really signed in: who is answerable for the request. */
  tester: string
  /** The person whose view the request runs with. */
  person: string
  /** The viewed person's name. */
  name: string
}

const viewing = new AsyncLocalStorage<ViewingAs>()

export function runViewingAs<T>(as: ViewingAs, fn: () => Promise<T>): Promise<T> {
  return viewing.run(as, fn)
}

/** The View as the request runs under, or null for an ordinary request. */
export function viewingAs(): ViewingAs | null {
  return viewing.getStore() ?? null
}
