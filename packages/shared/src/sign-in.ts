// person-identities (#275): the one list of sign-in method kinds and rules.
// The server's KINDS record, the Sign In Method Table's choices, the
// controller's messages and the web client's types all derive from these, so
// adding a kind is one edit here and the compiler finds every other place.
export const SIGN_IN_METHOD_KINDS = ['password', 'google', 'delegated_password'] as const
export type SignInMethodKind = (typeof SIGN_IN_METHOD_KINDS)[number]

export const NEW_PERSON_RULES = ['refuse', 'create_if_email_domain_allowed', 'create'] as const
export type NewPersonRule = (typeof NEW_PERSON_RULES)[number]
