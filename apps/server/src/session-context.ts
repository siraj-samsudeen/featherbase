// #473: whether the request in hand comes from a session that must not add a
// lasting way in — a test-mode sign-in or a dev-preview click-through (the
// sessions assertCanChangeAccess refuses, auth.ts). Set once per request by the
// auth middleware, so a write deep inside the generic save path (a form save,
// an import, a script) can still tell, without every caller threading it.
import { AsyncLocalStorage } from 'node:async_hooks'

const restricted = new AsyncLocalStorage<boolean>()

export function runInSession<T>(signIn: { test_mode?: boolean; preview?: boolean } | null | undefined, fn: () => Promise<T>): Promise<T> {
  return restricted.run(Boolean(signIn && (signIn.test_mode || signIn.preview)), fn)
}

/** False inside a request from a test-mode or preview session. */
export function sessionMayAddWayIn(): boolean {
  return restricted.getStore() !== true
}
