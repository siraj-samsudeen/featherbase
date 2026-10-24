import type postgres from 'postgres'
import { sql } from '../db'
import { AppError } from '../errors'
import { PLATFORM_SCHEMA } from '../platform-schema'
import type { SourceConfig } from './types'

// #432: a Data Source reaches foreign rows with its own credentials, past
// every hook, permission and history writer the platform runs. Pointed at
// the platform's own database it would read and write the platform's records
// (the audit tables included) as if they were foreign, so two rules hold:
//
//   1. A Data Source never connects to the platform's own database. "Own" is
//      decided by asking the server, not by reading the URL: one database is
//      reachable under many host names, ports and poolers.
//   2. A bound Table never names a relation in the platform schema, on any
//      database. Checked from the binding alone, so it needs no connection.

// Who the connected server says it is. The postmaster start time tells
// clusters apart; the database oid and name tell databases apart within one.
const IDENTITY_SQL = `select current_database() as db,
  (select oid::text from pg_database where datname = current_database()) as oid,
  pg_postmaster_start_time()::text as started`

type Identity = { db: string; oid: string; started: string }
const key = (r: Identity) => `${r.started}|${r.oid}|${r.db}`

let platformIdentity: Promise<string> | null = null
function platformKey(): Promise<string> {
  platformIdentity ??= sql
    .unsafe(IDENTITY_SQL)
    .then((rows) => key(rows[0] as unknown as Identity))
    .catch((err) => {
      platformIdentity = null
      throw err
    })
  return platformIdentity
}

export async function assertNotPlatformDatabase(
  cfg: SourceConfig,
  client: ReturnType<typeof postgres>,
): Promise<void> {
  let theirs: string
  try {
    const [row] = await client.unsafe(IDENTITY_SQL)
    theirs = key(row as unknown as Identity)
  } catch (err) {
    // A server that speaks the protocol but lacks these catalog functions
    // (SQLSTATE class 42) is not this platform's PostgreSQL. Anything else,
    // a connection failure above all, is the caller's to report.
    if (/^42/.test(String((err as { code?: string }).code ?? ''))) return
    throw err
  }
  if (theirs === (await platformKey()))
    throw new AppError(
      'PermissionError',
      `Data source ${cfg.name} connects to the platform's own database; a data source must point at another database`,
    )
}

export function assertNotPlatformRelation(sourceName: string, schema: string | null | undefined): void {
  if (schema === PLATFORM_SCHEMA)
    throw new AppError(
      'PermissionError',
      `A Table bound to data source ${sourceName} cannot use the platform schema "${PLATFORM_SCHEMA}"`,
      { external_schema: `"${PLATFORM_SCHEMA}" holds the platform's own records` },
    )
}
