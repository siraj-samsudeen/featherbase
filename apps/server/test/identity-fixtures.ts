// person-identities test helpers: configure Sign In Method rows and link
// identities directly, the way the migration and the admin endpoints leave them.
import { randomBytes } from 'node:crypto'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'

export const DELEGATED_URL = 'https://hr.example.test/api/login/'

/** Create or update a delegated-password method (default: StyleHR). */
export async function configureDelegated(o: { key?: string; label?: string; url?: string; enabled?: boolean } = {}) {
  const key = o.key ?? 'stylehr'
  const label = o.label ?? 'StyleHR'
  const url = o.url ?? DELEGATED_URL
  const [have] = await sql`select 1 from sign_in_method where row_id = ${key}`
  // Created with a usable address (the controller refuses an enabled method
  // without one); tests that need a bad address set it directly below.
  if (!have)
    await saveDoc(
      'Sign In Method',
      { row_id: key, kind: 'delegated_password', label: label || key, enabled: true, new_person: 'refuse', self_link: false, service_url: DELEGATED_URL },
      'Administrator',
    )
  await sql`update sign_in_method set label = ${label}, service_url = ${url}, enabled = ${o.enabled ?? true} where row_id = ${key}`
  return key
}

export async function removeDelegated() {
  await sql`delete from sign_in_identity where method in (select row_id from sign_in_method where kind = 'delegated_password')`
  await sql`delete from sign_in_method where kind = 'delegated_password'`
}

/** Link `user` at a delegated method: subject defaults to the user id (the
 *  roster convention, employee code = account id). */
export async function linkDelegated(user: string, signInName: string | null, o: { key?: string; subject?: string } = {}) {
  const id = 'uid_' + randomBytes(6).toString('hex')
  await sql`insert into sign_in_identity ${sql({
    id,
    person_id: user,
    method: o.key ?? 'stylehr',
    subject: o.subject ?? user,
    sign_in_name: signInName,
    linked_by: 'test',
  })}`
  return id
}

/** Adjust the Google method row. */
export async function configureGoogle(o: { client_id?: string; allowed_email_domains?: string; new_person?: string; enabled?: boolean; self_link?: boolean } = {}) {
  const [row] = await sql`select client_id, allowed_email_domains, new_person, enabled, self_link from sign_in_method where row_id = 'google'`
  await sql`update sign_in_method set
    client_id = ${o.client_id ?? row.client_id ?? ''},
    allowed_email_domains = ${o.allowed_email_domains ?? row.allowed_email_domains ?? ''},
    new_person = ${o.new_person ?? row.new_person},
    enabled = ${o.enabled ?? row.enabled},
    self_link = ${o.self_link ?? row.self_link}
    where row_id = 'google'`
}

export async function inviteGoogleRaw(user: string, email: string) {
  const id = 'uid_' + randomBytes(6).toString('hex')
  await sql`insert into sign_in_identity ${sql({ id, person_id: user, method: 'google', subject: null, pending_email: email.toLowerCase(), linked_by: 'test' })}`
  return id
}

export async function setPasswordMethod(o: { enabled?: boolean; new_person?: string }) {
  const [row] = await sql`select enabled, new_person from sign_in_method where row_id = 'password'`
  await sql`update sign_in_method set enabled = ${o.enabled ?? row.enabled}, new_person = ${o.new_person ?? row.new_person} where row_id = 'password'`
}
