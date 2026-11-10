import type { SignInClaims } from './auth'

/** #1176: the sign-in this session was made with, for the account menu. */
export async function signedInWith(_claims: SignInClaims | undefined, _person: string): Promise<{ method: string; value: string } | null> {
  return null
}
