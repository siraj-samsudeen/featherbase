// #1207 (mcp-oauth-connect): a connection is one Allow a person gave an agent.
// Here: when it is live, listing a person's, and ending them. Kept apart from
// the sign-in server (agent-auth.ts) so auth.ts can use it without a cycle.
import { sql, type Sql, type TxSql } from './db'

/** A connection (`ac`, joined to its person `p`) is live when it has not
 *  ended, was used within 30 days, its person is enabled, and it was made
 *  after the person's sessions were last ended (design D5, D10). */
export const liveConnection = (db: Sql | TxSql = sql) => db`(ac.ended_at is null
  and ac.last_used_at > now() - interval '30 days'
  and p.enabled
  and (p.sessions_ended_at is null or ac.created_at > p.sessions_ended_at))`

export interface ConnectionRow {
  id: string
  client_name: string
  return_place: string
  created_at: string
  last_used_at: string
}

/** A person's live connections, newest first (Connected apps). */
export async function listConnections(person: string): Promise<ConnectionRow[]> {
  const rows = await sql`
    select ac.id, ac.client_name, ac.return_place, ac.created_at, ac.last_used_at
    from agent_connection ac join person p on p.row_id = ac.person
    where ac.person = ${person} and ${liveConnection()}
    order by ac.created_at desc`
  return rows as unknown as ConnectionRow[]
}

/** End a person's connections (one, with `id`), and revoke their short keys.
 *  Answers how many were ended. */
export async function endConnections(person: string, reason: string, id?: string, db: Sql | TxSql = sql): Promise<number> {
  const ended = await db`
    update agent_connection set ended_at = now(), ended_reason = ${reason}
    where person = ${person} and ended_at is null ${id === undefined ? db`` : db`and id = ${id}`}
    returning id`
  if (ended.length)
    await db`update access_token set revoked_at = coalesce(revoked_at, now())
      where agent_connection = any(${ended.map((row) => row.id as string)}::text[])`
  return ended.length
}
