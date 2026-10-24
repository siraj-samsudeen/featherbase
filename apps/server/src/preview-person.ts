// The person a dev-preview link signs in as (person-rename). PREVIEW_LOGIN_USER
// names them the way people are named — an email or a username — because a
// person's id is minted (`psn_…`) and cannot be known in advance.
import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { saveDoc } from './document'
import { setUserPassword } from './auth'

/** The one person PREVIEW_LOGIN_USER names (id, email or username, ignoring
 *  case), or null when it names nobody or more than one. Never a built-in. */
export async function resolvePreviewPerson(user: string): Promise<string | null> {
  const rows = await sql`
    select row_id from person
    where not built_in and (row_id = ${user} or lower(email) = lower(${user}) or lower(username) = lower(${user}))
    limit 2`
  return rows.length === 1 ? String(rows[0].row_id) : null
}

/** Find or create the preview person — System Manager, not Administrator —
 *  converging on a second run (it runs on every deploy). */
export async function ensurePreviewPerson(user: string, fullName: string, log: (m: string) => void = console.log): Promise<string> {
  const existing = await resolvePreviewPerson(user)
  if (existing) {
    // Converge rather than recreate: a re-deploy must not reset a session or
    // strip a role someone added by hand while looking at the preview.
    await sql`update person set enabled = true where row_id = ${existing}`
    log(`preview person ${existing} (${user}) already exists — left in place`)
    return existing
  }
  const isEmail = user.includes('@')
  const created = await saveDoc(
    'Person',
    {
      ...(isEmail ? { email: user } : { username: user.toLowerCase() }),
      full_name: fullName,
      enabled: true,
      roles: [{ role: 'System Manager' }, { role: 'All' }],
    },
    'Administrator',
    'insert',
  )
  const id = String(created.row_id)
  // The preview signs in through /preview, so no human ever types this. Give
  // it a random one anyway: a password-less account is a worse thing to
  // leave lying around, and login() already refuses one.
  await setUserPassword(id, randomBytes(24).toString('base64url'))
  log(`created preview person ${id} (${user}; System Manager, not Administrator)`)
  return id
}
