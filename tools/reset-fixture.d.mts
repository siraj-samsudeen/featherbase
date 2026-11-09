import type { SpawnSyncReturns } from 'node:child_process'

/** Two disposable local development instances, each with its own database and uploads. */
export interface ResetFixture {
  base: string
  names: string[]
  urls: string[]
  stores: string[]
  run(args: string[], overrides?: Record<string, string>): SpawnSyncReturns<string>
  assertPreserved(opts?: { selected?: boolean }): Promise<void>
  assertRemoved(): Promise<void>
  attemptUnsafeSelections(): Promise<SpawnSyncReturns<string>[]>
  close(): Promise<void>
}

export function resetFixture(): Promise<ResetFixture>
