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

// Who the connected server says it is. `system_identifier` is fixed when a
// cluster is initialised (a physical replica shares it, and is the same data)
// and the database oid is fixed when a database is created, so the pair
// survives restarts and is the same in every session whatever its settings.
// Where pg_control_system is not granted, the postmaster start time stands in,
// as epoch seconds so the session TimeZone cannot change it. Both sides are
// read on every check: nothing cached can go stale across a restart.
const IDENTITY_SQL = `select
  (select oid::text from pg_database where datname = current_database()) as oid,
  case when has_function_privilege('pg_catalog.pg_control_system()', 'execute')
    then (select system_identifier::text from pg_catalog.pg_control_system()) end as system_id,
  extract(epoch from pg_postmaster_start_time())::text as started`

type Identity = { oid: string; system_id: string | null; started: string }

type Queryable = { unsafe: (q: string) => PromiseLike<readonly unknown[]> }

export async function readIdentity(client: Queryable): Promise<Identity> {
  const [row] = (await client.unsafe(IDENTITY_SQL)) as Identity[]
  return { oid: String(row.oid), system_id: row.system_id == null ? null : String(row.system_id), started: String(row.started) }
}

export function sameDatabase(a: Identity, b: Identity): boolean {
  if (a.oid !== b.oid) return false
  if (a.system_id != null && b.system_id != null) return a.system_id === b.system_id
  return a.started === b.started
}

export async function assertNotPlatformDatabase(
  cfg: SourceConfig,
  client: ReturnType<typeof postgres>,
): Promise<void> {
  let theirs: Identity
  try {
    theirs = await readIdentity(client)
  } catch (err) {
    // A server that speaks the protocol but lacks these catalog functions
    // (SQLSTATE class 42) is not this platform's PostgreSQL. Anything else,
    // a connection failure above all, is the caller's to report.
    /* v8 ignore next -- a server that speaks the PostgreSQL protocol without its catalog functions cannot be stood up in the test stack */
    if (/^42/.test(String((err as { code?: string }).code ?? ''))) return
    throw err
  }
  if (sameDatabase(await readIdentity(sql), theirs))
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
