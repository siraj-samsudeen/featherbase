// #1176: the account menu says which sign-in THIS session was made with, so someone with both a
// StyleHR ID and an email knows which they used. From the session's own claims (the method and
// identity it was issued with), never from the person's list of linked methods: the Sign-in
// methods page is that list.
import { sql } from './db'
import type { SignInClaims } from './auth'
import { getSignInMethod } from './identities'

export interface SignedInWith {
  /** The method as people know it: its own label (StyleHR, Google), or "email" for a password. */
  method: string
  /** The identity used: the ID people type, the Google account's email, or the account's email. */
  value: string
}

/** Null whenever it can't be said for certain (no recorded method, test mode, a preview, an
 *  identity that isn't this person's): the menu then shows the name only, never a wrong label. */
export async function signedInWith(claims: SignInClaims | undefined, person: string): Promise<SignedInWith | null> {
  if (!claims?.method || claims.test_mode || claims.preview) return null
  const method = await getSignInMethod(claims.method)
  if (!method) return null
  if (method.kind === 'password') {
    const [row] = await sql`select email from person where row_id = ${person}`
    return row?.email ? { method: 'email', value: String(row.email) } : null
  }
  if (!claims.identity) return null
  const [identity] = await sql`select sign_in_name, email from sign_in_identity where id = ${claims.identity} and person_id = ${person}`
  // StyleHR shows the ID people type (sign_in_name), never its internal record code (subject).
  const value = method.kind === 'google' ? identity?.email : identity?.sign_in_name
  return value ? { method: method.label || method.key, value: String(value) } : null
}
