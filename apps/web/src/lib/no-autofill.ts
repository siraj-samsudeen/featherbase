// #1266: a field that names SOMEONE ELSE's sign-in (a StyleHR login, a Google
// address to invite, an identifier) must never be filled by the browser or a
// password manager with the signed-in person's own address: one click on Link
// would tie the manager's address to another person. autocomplete="off", plus
// the opt-outs the common password managers read (1Password, LastPass,
// Dashlane), and input names that aren't email/username.

/** For a form whose fields name someone else's sign-in. */
export const NO_AUTOFILL_FORM = { autoComplete: 'off', 'data-1p-ignore': true, 'data-lpignore': 'true', 'data-form-type': 'other' } as const

/** For each such field. */
export const NO_AUTOFILL_FIELD = { autoComplete: 'off', 'data-1p-ignore': true, 'data-lpignore': 'true', 'data-form-type': 'other' } as const
