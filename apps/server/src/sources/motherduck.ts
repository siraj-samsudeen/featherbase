// #772 design D2, #969: the instance has one MotherDuck token. A session is an
// in-memory DuckDB with MotherDuck in single-attach mode: it attaches only the
// databases chosen for the source, read-only, so neither the account nor the
// warehouse can change, whatever rights the token has (ADR 0020).
// The listing SQL reads md_information_schema, which the test stand-in (D4,
// MOTHERDUCK_STANDIN) provides as a local file, so every query here runs in tests.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api'
import { AppError } from '../errors'
import { readVariable } from '../env'
import { openMotherDuck } from '../motherduck-hosted'
import { attachStatement, requireMotherDuckToken } from '../motherduck-reader'

/** A database a source reads. Only its name is kept: its address is looked up
 *  from what the token can read each time a session opens. */
export interface ChosenDatabase { name: string; owner?: string }
export interface WarehouseDatabase { name: string; address: string; owner: string }
export interface WarehouseReport { user: string; databases: WarehouseDatabase[] }

/** One open MotherDuck session; `attach` opens one database under `alias`.
 *  It is always read-only: there is no writable form (ADR 0020). */
export interface MotherDuckSession {
  instance: DuckDBInstance
  attach(address: string, alias: string): Promise<void>
  user(conn: DuckDBConnection): Promise<string>
  ownedAddress(name: string): string
  close(): void
}

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`

async function openStandin(dir: string, token: string): Promise<MotherDuckSession> {
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const instance = await DuckDBInstance.create(':memory:')
  // Each session reads its own copy, so a test can change a database file while
  // a session is open (DuckDB locks an attached file); Refresh opens a new session.
  const copies = mkdtempSync(path.join(tmpdir(), `fb-md-session-${path.basename(dir)}-`))
  const copyOf = (file: string) => {
    const target = path.join(copies, `${Math.random().toString(36).slice(2)}-${path.basename(file)}`)
    copyFileSync(file, target)
    return target
  }
  const conn = await instance.connect()
  try {
    await conn.run(`attach ${sqlText(copyOf(path.join(dir, 'md_information_schema.duckdb')))} as md_information_schema (read_only)`)
    const rows = (await conn.runAndReadAll('select user_name from md_information_schema.tokens where token = ?', [token])).getRowObjectsJson()
    if (!rows.length) throw new Error(`Invalid token "${token}": authentication failed`)
    return {
      instance,
      async attach(address, alias) {
        const c = await instance.connect()
        try { await c.run(attachStatement(copyOf(address), alias)) } finally { c.closeSync() }
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

/** The instance's one token, or a plain refusal naming the variable. */
export function instanceToken(): string {
  const token = readVariable('MOTHERDUCK_TOKEN')?.trim()
  if (!token) throw new AppError('ValidationError', 'MOTHERDUCK_TOKEN is not set on this server, so it cannot reach MotherDuck.')
  return token
}

/** The plain reason a MotherDuck call failed, with the token scrubbed out. */
export function motherDuckError(err: unknown, token: string): AppError {
  if (err instanceof AppError) return err
  const raw = String(err).replace(/^Error: /, '').split(token).join('[token]')
  if (/token|auth|unauthori[sz]ed|forbidden|credential/i.test(raw))
    return new AppError('ValidationError', 'MotherDuck refused this server\'s token (MOTHERDUCK_TOKEN). Check that all of it was set and that it has not been revoked.')
  return new AppError('DataSourceError', `MotherDuck could not be reached: ${raw}`)
}

async function rows(conn: DuckDBConnection, text: string): Promise<Record<string, unknown>[]> {
  return (await conn.runAndReadAll(text)).getRowObjectsJson() as Record<string, unknown>[]
}

/** Every database the session's token can read: the account's own and those shared with it. */
async function readableDatabases(session: MotherDuckSession, conn: DuckDBConnection): Promise<WarehouseDatabase[]> {
  const owned = await rows(conn, 'select name from md_information_schema.databases order by name')
  const shared = await rows(conn, 'select name, url, owner from md_information_schema.shared_with_me order by name')
  return [
    ...owned.map((r) => ({ name: String(r.name), address: session.ownedAddress(String(r.name)), owner: 'This account' })),
    ...shared.map((r) => ({ name: String(r.name), address: String(r.url), owner: String(r.owner) })),
  ]
}

/** Who the instance's token signs in as, and every database it can read. */
export async function inspectWarehouse(): Promise<WarehouseReport> {
  const token = instanceToken()
  let session: MotherDuckSession | undefined
  try {
    session = await openSession(token)
    const conn = await session.instance.connect()
    try {
      return { user: await session.user(conn), databases: await readableDatabases(session, conn) }
    } finally {
      conn.closeSync()
    }
  } catch (err) {
    throw motherDuckError(err, token)
  } finally {
    session?.close()
  }
}

/** The one readable database called `name`, or a plain refusal: a database is
 *  never guessed from the order MotherDuck lists two of one name in. */
export function pickDatabase(readable: WarehouseDatabase[], name: string): WarehouseDatabase {
  const matches = readable.filter((d) => d.name === name)
  if (!matches.length) throw new AppError('ValidationError', `This server's MotherDuck token cannot read the database ${name}`, { databases: `The token cannot read ${name}` })
  if (matches.length > 1)
    throw new AppError('ValidationError', `Two databases the token can read are called ${name} (from ${matches.map((d) => d.owner).join(' and ')}); Featherbase cannot tell them apart`, { databases: `Two databases are called ${name}` })
  return matches[0]
}

/** A session with the source's chosen databases attached, each under its name.
 *  An `address` kept on an older row is ignored: what the token can read decides. */
export async function openSourceSession(token: string, databases: ChosenDatabase[]): Promise<MotherDuckSession> {
  let session: MotherDuckSession | undefined
  try {
    session = await openSession(token)
    const conn = await session.instance.connect()
    try {
      const readable = await readableDatabases(session, conn)
      for (const { name } of databases) await session.attach(pickDatabase(readable, name).address, name)
    } finally {
      conn.closeSync()
    }
    return session
  } catch (err) {
    session?.close()
    throw motherDuckError(err, token)
  }
}

/** One read by the platform's own fixed SQL (a dataset refresh, the leaver
 *  check), on a session holding only `databases`, read-only like any source's. */
export async function readMotherDuck(sqlText: string, purpose: string, databases: string[]): Promise<unknown[][]> {
  const token = requireMotherDuckToken(purpose)
  const session = await openSourceSession(token, databases.map((name) => ({ name })))
  try {
    const conn = await session.instance.connect()
    try {
      return (await conn.runAndReadAll(sqlText)).getRows() as unknown[][]
    } finally {
      conn.closeSync()
    }
  } catch (err) {
    throw motherDuckError(err, token)
  } finally {
    session.close()
  }
}
