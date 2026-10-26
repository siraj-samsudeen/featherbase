# Proposal

## Why

Three things on the sign-in page tell people more, or less, than they should.

- In test mode the StyleHR form shows a banner saying that no password is
  needed, and it hides the password box. The trial is run with real store
  staff watching, and the shortcut should be known only to the people who need
  it. Siraj asked on 26-Oct-2026 for the test-mode form to look exactly like
  the ordinary one.
- A refused Google sign-in lands the browser on a raw JSON error page
  (`{"error":{"type":"AuthenticationError","message":"Access not provisioned
  …"}}`), because the refusal comes back from a browser redirect.
- The password form shows the server's request-shape message ("Expected {
  usr, pwd }") when it is posted empty. It also has example text, a grey
  "Administrator" and a row of dots, which looks like a filled-in username and
  password. On 26-Oct-2026 Siraj took that grey text for an autofill preview
  and submitted the form with nothing in it.

## What Changes

- Test mode keeps its server behaviour: the service is not asked, and any
  password, or none, is accepted for a linked person's employee code. The page
  no longer shows it. The form has the same labels, the same hint and a
  password box, and it asks for both fields, as the ordinary form does.
  `/api/brand` still reports `test_mode` for the server tests and the
  sign-in-methods page.
- A refused Google sign-in that arrives as a browser navigation goes back to
  `/featherbase/login?error=<code>`. The codes are `not_provisioned`,
  `not_allowed`, `address_in_use`, `google_off`, `expired` and
  `google_failed`. The page explains each one in one plain sentence and
  reveals nothing else. A fetch/XHR caller still gets the JSON error and its
  status.
- The password form checks for empty fields before it posts. It drops the
  example text, and it never shows a server validation message: a request
  shape reads as "Enter your email or username and your password.", and an
  unexpected failure reads as a generic "Sign-in failed. Please try again."

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: test mode is not shown on the page; a refused Google
  sign-in is explained on the sign-in page; the sign-in forms never show raw
  server messages.

## Impact

- `apps/server/src/index.ts`, `sign-in.ts` and `oauth.ts`: refusal codes on
  the Google start and callback routes.
- `apps/web/src/pages/Login.tsx`: the test-mode form, the refusal notice,
  empty-field checks and error wording.
- No schema, migration or dependency changes.
