// Hosted-service boundary (ADR 0012): opening a MotherDuck session needs a
// live token. This module alone is excluded from local coverage; callers'
// token validation and query construction stay measured.
import { readVariable } from './env'
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

// #772 design D4: a pasted-token session opens live MotherDuck, unless
// MOTHERDUCK_STANDIN (development and test only) names the local stand-in.
export function openMotherDuck(
  token: string,
  openStandin: (dir: string, token: string) => Promise<import('./sources/motherduck').MotherDuckSession>,
): Promise<import('./sources/motherduck').MotherDuckSession> {
  const standin = readVariable('MOTHERDUCK_STANDIN')?.trim()
  return standin ? openStandin(standin, token) : openHostedMotherDuck(token)
}

// #772 design D2: a session for a source connected by a pasted token. MotherDuck
// refuses `md:?attach_mode=single` without a database name, so the session is an
// in-memory DuckDB with the extension loaded in single-attach mode; each chosen
// database is then attached by its own address. The tested logic lives in
// sources/motherduck.ts, which also opens the local stand-in.
export async function openHostedMotherDuck(token: string): Promise<import('./sources/motherduck').MotherDuckSession> {
  if (!/^[A-Za-z0-9._-]+$/.test(token)) throw new Error('The token is not a MotherDuck token: authentication failed')
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const instance = await DuckDBInstance.create(':memory:')
  const conn = await instance.connect()
  try {
    await conn.run('load motherduck')
    await conn.run(`set global motherduck_token = '${token}'`)
    await conn.run(`set global motherduck_attach_mode = 'single'`)
  } catch (err) {
    instance.closeSync()
    throw err
  } finally {
    conn.closeSync()
  }
  return {
    instance,
    async attach(address, alias, readOnly = true) {
      if (!/^md:(_share\/[A-Za-z0-9_-]+\/[0-9a-f-]+|[A-Za-z0-9_]+)$/.test(address)) throw new Error(`Not a MotherDuck database address: ${address}`)
      const c = await instance.connect()
      try { await c.run(`attach '${address}' as "${alias.replace(/"/g, '""')}"${readOnly ? ' (read_only)' : ''}`) } finally { c.closeSync() }
    },
    async user(c) {
      const reader = await c.runAndReadAll('select current_user() as name')
      return String(reader.getRowObjectsJson()[0].name)
    },
    ownedAddress: (name) => `md:${name}`,
    close: () => instance.closeSync(),
  }
}
