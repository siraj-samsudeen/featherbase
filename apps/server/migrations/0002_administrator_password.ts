// The first Administrator's password: ADMIN_PASSWORD, or `admin` on a
// developer's machine or in a test run, and only while the Administrator has
// none (src/admin-bootstrap.ts). A step of its own because it reads the
// install's variables, which the generated baseline must not depend on.
// #1336: it writes the column the baseline has; 0172 moves every hash into
// person_credential, this one included.
import { hashPassword } from '../src/auth'
import { administratorBootstrapPassword } from '../src/admin-bootstrap'
import { sql } from '../src/db'

export async function up() {
  const password = administratorBootstrapPassword()
  if (password === null) return
  await sql`update person set password_hash = ${hashPassword(password)}
    where row_id = 'Administrator' and password_hash is null`
}
