// API-004: give Administrator a login password (env ADMIN_PASSWORD, default
// 'admin' for local dev).
import { sql } from '../src/db'
import { hashPassword } from '../src/auth'

export async function up() {
  const pwd = process.env.ADMIN_PASSWORD ?? 'admin'
  await sql`
    update tab_user set password_hash = ${hashPassword(pwd)}
    where name = 'Administrator' and password_hash is null`
}
