// person-identities (#275): the one list of sign-in method kinds and rules.
// The server's KINDS record, the Sign In Method Table's choices, the
// controller's messages and the web client's types all derive from these, so
// adding a kind is one edit here and the compiler finds every other place.
export const SIGN_IN_METHOD_KINDS = ['password', 'google', 'delegated_password'] as const
export type SignInMethodKind = (typeof SIGN_IN_METHOD_KINDS)[number]

// #970: create_if_on_roster makes a person only when the ID they typed is one
// current row of the staff Table the method's settings name, and the service
// confirms the sign-in.
export const NEW_PERSON_RULES = ['refuse', 'create_if_email_domain_allowed', 'create', 'create_if_on_roster'] as const
export type NewPersonRule = (typeof NEW_PERSON_RULES)[number]

// #829: a person a sign-in rule creates is recorded as created by the
// sign-in itself, not by Administrator. The actor is not a person; it holds
// System Manager only inside that one save (apps/server/src/system-actor.ts).
export const signInActor = (kind: SignInMethodKind): string => `${kind.replace(/_/g, '-')}-sign-in`

/** How such an actor reads wherever a person's name would show. */
export const SYSTEM_ACTOR_LABELS: Readonly<Record<string, string>> = {
  [signInActor('google')]: 'Google sign-in',
  [signInActor('password')]: 'Password sign-in',
  [signInActor('delegated_password')]: 'Connected service sign-in',
}
