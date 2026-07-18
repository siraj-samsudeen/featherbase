// The Ecto-SQL-Sandbox pattern for postgres.js: run a body of work inside a
// real Postgres transaction that is ALWAYS rolled back. While the sandbox is
// active the app's global `sql` delegates to the transaction handle (the
// consuming app provides the seam via `setDelegate`), and the app's own
// `sql.begin` calls become SAVEPOINTs — so the full production code path
// (transactions included) runs against the real database, yet leaves no trace.

export interface SqlLike {
  begin<T>(fn: (tx: unknown) => Promise<T>): Promise<T>
}

export interface SandboxHooks {
  /** The app's root-capable sql (delegating proxy is fine — it must be
   * un-sandboxed when `withSandbox` is entered). */
  sql: SqlLike
  /** Swap the app's global sql delegate; `null` restores the real pool. */
  setDelegate(tx: unknown | null): void
  /** Clear per-process caches that could leak rolled-back state (meta cache,
   * rate-limit counters, ...). Runs after every sandbox, pass or fail. */
  onTeardown?(): void | Promise<void>
}

class RollbackSignal extends Error {
  constructor() {
    super('feather-testing-postgres: sandbox rollback (this should never surface)')
  }
}

export async function withSandbox<T>(
  hooks: SandboxHooks,
  fn: (tx: unknown) => Promise<T>,
): Promise<T> {
  let result: T | undefined
  let failure: unknown
  let failed = false
  try {
    await hooks.sql.begin(async (tx) => {
      hooks.setDelegate(tx)
      try {
        result = await fn(tx)
      } catch (e) {
        failed = true
        failure = e
      } finally {
        hooks.setDelegate(null)
      }
      // Reaching COMMIT would persist test writes; the sentinel forces a
      // ROLLBACK on both the pass and fail paths.
      throw new RollbackSignal()
    })
  } catch (e) {
    if (!(e instanceof RollbackSignal)) throw e
  } finally {
    hooks.setDelegate(null)
    await hooks.onTeardown?.()
  }
  if (failed) throw failure
  return result as T
}
