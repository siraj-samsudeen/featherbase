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
// tested on its own (readMotherDuck below is the one coverage-excluded entry).
export function requireMotherDuckToken(purpose: string): string {
  const token = readVariable('MOTHERDUCK_TOKEN')
  if (!token) throw new Error(`MOTHERDUCK_TOKEN is not set (required to ${purpose})`)
  return token
}

// The network call: opens a MotherDuck session and runs one statement. Needs
// a live token and the hosted service, so it is excluded from coverage (ADR
// 0012); the token check above is tested.
/* v8 ignore start -- network call to the hosted MotherDuck service; no test can reach it without a live token */
export async function readMotherDuck(sqlText: string, purpose: string): Promise<unknown[][]> {
  const token = requireMotherDuckToken(purpose)
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const instance = await DuckDBInstance.create(`md:?motherduck_token=${token}`)
  try {
    const conn = await instance.connect()
    try {
      const reader = await conn.runAndReadAll(sqlText)
      return reader.getRows() as unknown[][]
    } finally {
      conn.closeSync()
    }
  } finally {
    instance.closeSync()
  }
}
/* v8 ignore stop */
