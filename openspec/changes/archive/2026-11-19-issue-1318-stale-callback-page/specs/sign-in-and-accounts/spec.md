## MODIFIED Requirements

### Requirement: A refused sign-in is explained on the sign-in page

A sign-in that the browser reaches by navigation, such as the Google sign-in
and its return from Google, SHALL NOT show a raw error.

#### Normative details for the whole requirement

When it is refused,
the browser SHALL go back to the sign-in page with a short reason, and the
page SHALL explain it in one plain sentence that says what to do next (ask
their manager or IT, try again, or use another way in) and reveals nothing
else: no address, no domain, and no detail of the account. A caller that does
not ask for a page, such as a script, SHALL get the error as before. The return
from the provider is only ever a page, so there only a caller that asks for
JSON, or a browser fetch, SHALL get the error; any other caller is sent to the
sign-in page (#1318).

#### Scenario: A Google account nobody set up

- **WHEN** someone signs in with a Google account that has no invite and whose
  domain is not allowed
- **THEN** they are back on the sign-in page, told that this Google account
  is not set up and to ask their manager or IT to invite them, or to sign in
  with the connected service when one is offered

#### Scenario: Other refusals read plainly too

- **WHEN** a Google sign-in is refused because the account is disabled, its
  address is already used by another account, Google sign-in is turned off,
  the sign-in took too long or started in another window, or Google did not
  answer
- **THEN** the sign-in page says so in one plain sentence, and an unknown
  reason reads as a generic failure

#### Scenario: An API caller keeps the error

- **WHEN** the same refusal reaches a caller that did not ask for a page, or,
  on the return from the provider, a caller that asks for JSON or a browser
  fetch
- **THEN** it gets the error response and status it got before

#### Scenario: A stale or replayed callback

- **WHEN** a Google or Microsoft sign-in callback is opened again without the
  sign-in cookie, by a caller that asks for neither a page nor JSON
- **THEN** it lands on the sign-in page, told the sign-in took too long or
  started in another window
