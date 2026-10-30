// One way to read the warehouse: `@duckdb/node-api` against MotherDuck, loaded
// lazily — the native module is ~100MB and a server that never reads the
// warehouse should not pay for it at boot (the same reason
// `sources/duckdb-driver.ts` defers it).
//
// The token is read from the process environment and is never logged, returned
// or persisted.
import { readVariable } from './env'

export type WarehouseReader = (sqlText: string) => Promise<unknown[][]>

// The token is required before any network use; the check is pure, so it is
// tested on its own (motherduck-hosted.ts is the coverage-excluded entry).
export function requireMotherDuckToken(purpose: string): string {
  const token = readVariable('MOTHERDUCK_TOKEN')
  if (!token) throw new Error(`MOTHERDUCK_TOKEN is not set (required to ${purpose})`)
  return token
}
