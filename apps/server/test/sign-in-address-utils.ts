import { sql } from '../src/db'

/** The address each of a person's sign-ins recorded, oldest first (#396). */
export async function signInAddresses(person: string): Promise<(string | null)[]> {
  const rows = await sql`select ip_address from activity_log where "user" = ${person} and operation = 'login' order by created_at, row_id`
  return rows.map((r) => (r.ip_address as string | null) ?? null)
}

/** A CLIENT_ADDRESS_HEADER request header naming this client address. */
export const FROM_CLIENT = { 'x-real-ip': '198.51.100.7' }
export const CLIENT = '198.51.100.7'
