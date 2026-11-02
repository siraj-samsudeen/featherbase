// #772 design D2: a MotherDuck source connected by a pasted token. A session is
// an in-memory DuckDB with MotherDuck in single-attach mode: it attaches only the
// databases chosen for the source, so the MotherDuck account is never changed.
// The listing SQL reads md_information_schema, which the test stand-in (D4,
// MOTHERDUCK_STANDIN) provides as a local file, so every query here runs in tests.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api'
import { AppError } from '../errors'
import { openMotherDuck } from '../motherduck-hosted'

export interface WarehouseDatabase { name: string; address: string; owner: string }
export interface TokenReport { user: string; can_write: boolean; databases: WarehouseDatabase[] }

/** One open MotherDuck session; `attach` opens one database under `alias`,
 *  read-only unless `readOnly` is false (only Test's write probe does that). */
export interface MotherDuckSession {
  instance: DuckDBInstance
  attach(address: string, alias: string, readOnly?: boolean): Promise<void>
  user(conn: DuckDBConnection): Promise<string>
  ownedAddress(name: string): string
  close(): void
}

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`
export const quoteAlias = (value: string) => `"${value.replace(/"/g, '""')}"`

async function openStandin(dir: string, token: string): Promise<MotherDuckSession> {
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const instance = await DuckDBInstance.create(':memory:')
  // Each session reads its own copy, so a test can change a database file while
  // a session is open (DuckDB locks an attached file); Refresh opens a new session.
  const copies = mkdtempSync(path.join(tmpdir(), 'fb-md-session-'))
  const copyOf = (file: string) => {
    const target = path.join(copies, `${Math.random().toString(36).slice(2)}-${path.basename(file)}`)
    copyFileSync(file, target)
    return target
  }
  const conn = await instance.connect()
  try {
    await conn.run(`attach ${sqlText(copyOf(path.join(dir, 'md_information_schema.duckdb')))} as md_information_schema (read_only)`)
    const rows = (await conn.runAndReadAll('select user_name, can_write from md_information_schema.tokens where token = ?', [token])).getRowObjectsJson()
    if (!rows.length) throw new Error(`Invalid token "${token}": authentication failed`)
    const canWrite = rows[0].can_write === true
    return {
      instance,
      async attach(address, alias, readOnly = true) {
        const c = await instance.connect()
        try {
          // A share is always read-only; the account's own databases only for a read scaling token.
          const writable = !readOnly && canWrite && path.dirname(address) === dir
          await c.run(`attach ${sqlText(copyOf(address))} as ${quoteAlias(alias)}${writable ? '' : ' (read_only)'}`)
        } finally { c.closeSync() }
      },
      user: async () => String(rows[0].user_name),
      ownedAddress: (name) => path.join(dir, `${name}.duckdb`),
      close: () => { instance.closeSync(); rmSync(copies, { recursive: true, force: true }) },
    }
  } catch (err) {
    instance.closeSync()
    rmSync(copies, { recursive: true, force: true })
    throw err
  } finally {
    conn.closeSync()
  }
}

// Live MotherDuck or the stand-in: the hosted-service module decides (ADR 0012).
export const openSession = (token: string): Promise<MotherDuckSession> => openMotherDuck(token, openStandin)

/** The plain reason a MotherDuck call failed, with the token scrubbed out. */
export function motherDuckError(err: unknown, token: string): AppError {
  const raw = String(err).replace(/^Error: /, '').split(token).join('[token]')
  if (/token|auth|unauthori[sz]ed|forbidden|credential/i.test(raw))
    return new AppError('ValidationError', 'MotherDuck refused the token. Check that all of it was copied and that it has not been revoked.')
  return new AppError('DataSourceError', `MotherDuck could not be reached: ${raw}`)
}

async function rows(conn: DuckDBConnection, text: string): Promise<Record<string, unknown>[]> {
  return (await conn.runAndReadAll(text)).getRowObjectsJson() as Record<string, unknown>[]
}

/** Test a pasted token: who it signs in as, whether it can write, and every
 *  database it can read (the account's own and those shared with it). */
export async function inspectToken(token: string): Promise<TokenReport> {
  let session: MotherDuckSession | undefined
  try {
    session = await openSession(token)
    const conn = await session.instance.connect()
    try {
      const owned = await rows(conn, 'select name from md_information_schema.databases order by name')
      const shared = await rows(conn, 'select name, url, owner from md_information_schema.shared_with_me order by name')
      const databases: WarehouseDatabase[] = [
        ...owned.map((r) => ({ name: String(r.name), address: session!.ownedAddress(String(r.name)), owner: 'This account' })),
        ...shared.map((r) => ({ name: String(r.name), address: String(r.url), owner: String(r.owner) })),
      ]
      // A read scaling token opens even the account's own databases read-only,
      // so attaching one answers "can it write?" without attempting a write.
      let canWrite = false
      if (owned.length) {
        await session.attach(session.ownedAddress(String(owned[0].name)), 'featherbase_probe', false)
        const [probe] = await rows(conn, "select readonly from duckdb_databases() where database_name = 'featherbase_probe'")
        canWrite = probe?.readonly === false
      }
      return { user: await session.user(conn), can_write: canWrite, databases }
    } finally {
      conn.closeSync()
    }
  } catch (err) {
    throw motherDuckError(err, token)
  } finally {
    session?.close()
  }
}

/** A session with the source's chosen databases attached, each under its name. */
export async function openSourceSession(token: string, databases: WarehouseDatabase[]): Promise<MotherDuckSession> {
  let session: MotherDuckSession | undefined
  try {
    session = await openSession(token)
    for (const db of databases) await session.attach(db.address, db.name)
    return session
  } catch (err) {
    session?.close()
    throw motherDuckError(err, token)
  }
}
