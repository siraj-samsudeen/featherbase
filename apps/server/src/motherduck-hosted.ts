// Hosted-service boundary (ADR 0012): opening a MotherDuck session needs a
// live token. This module alone is excluded from local coverage; callers'
// token validation and query construction stay measured.
import { requireMotherDuckToken } from './motherduck-reader'

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
