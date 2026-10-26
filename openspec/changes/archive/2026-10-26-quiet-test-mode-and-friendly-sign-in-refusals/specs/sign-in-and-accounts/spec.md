# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: A refused sign-in is explained on the sign-in page

A sign-in that the browser reaches by navigation (the Google sign-in and its
return from Google) SHALL NOT show a raw error. When it is refused, the
browser SHALL go back to the sign-in page with one short reason code, and the
page SHALL explain that reason in one plain sentence. The page tells the
person what to do next (ask their manager or IT, try again, or use another
way in) and SHALL NOT reveal anything else: no address, no domain, and no
detail of the account. A caller that does not ask for a page (a script or an
API client) SHALL get the error as before.

The sign-in card SHALL show this as a panel of next steps, not as a notice
above an empty form (#474). The panel is headed "We couldn't sign you in" and
carries the plain sentence. It offers "Sign in with" the connected service as
the main action when one is on, which opens that service's form; "Try another
Google account", which starts Google sign-in again with Google's account
picker forced, so the refused account is never reused without the person
choosing it; and a quiet "Other ways to sign in" link that shows the usual
ways in. The panel SHALL show no input fields until the person picks one of
these. Without a connected service, "Try another Google account" is the main
action. The panel's sentence SHALL NOT repeat the connected service its button
already offers. Once the person chooses, the reason code SHALL leave the
address, so a reload shows the usual sign-in, not the panel again.

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

#### Scenario: The panel offers the next step, not an empty form

- **WHEN** a refused Google sign-in comes back to the sign-in page and a
  connected service such as StyleHR is on
- **THEN** the card shows "We couldn't sign you in" with the plain sentence,
  "Sign in with StyleHR" as the main action, "Try another Google account" and
  "Other ways to sign in", and no input field

#### Scenario: The person picks a next step

- **WHEN** the person picks "Sign in with StyleHR", "Try another Google
  account" or "Other ways to sign in"
- **THEN** they get the StyleHR form, a new Google sign-in that shows Google's
  account picker, or the usual ways in with the reason still shown above them

#### Scenario: No connected service

- **WHEN** the same refusal comes back and no connected service is on
- **THEN** "Try another Google account" is the main action

#### Scenario: An API caller keeps the error

- **WHEN** the same refusal reaches a caller that did not ask for a page
- **THEN** it gets the error response and status it got before

### Requirement: The sign-in forms never show a raw server message

A sign-in form SHALL check that the fields it needs are filled before it
sends anything, and say plainly what to enter when they are not. It SHALL
read what is in the boxes when it is submitted, so values the browser's
autofill wrote are sent. It SHALL NOT show example text that could pass for a
filled-in value. A server message SHALL be shown only when it is worded for
people (a wrong password, an outage, someone who has left). A validation
message about the request's shape, or an unexpected failure, SHALL read as a
plain sentence.

#### Scenario: Submitted empty

- **WHEN** someone submits the password form with an empty field
- **THEN** it says "Enter your email or username and your password." and
  sends nothing

#### Scenario: The server answers with a request-shape message

- **WHEN** the server answers a sign-in with a validation message such as
  "Expected { usr, pwd }", or with an unexpected failure
- **THEN** the page shows a plain sentence instead, never the server's text

## MODIFIED Requirements

### Requirement: Test mode for sign-in through a connected service

A deployment MAY switch on test mode for sign-in through a connected service,
only through its server environment and only with an exact switch value, and
only on a development, test or staging server — staging being a hosted trial
instance that is a production server in every other respect: any other server
refuses to start with it set. While it is on, the service SHALL NOT be asked: a tester signs in as a
person by typing the employee code on that person's record, in any mix of
capitals, with any password or none. The code must belong to exactly one
person, and that person must have a live, unended link to the service; who
may sign in is otherwise unchanged — one enabled account, and not the
Administrator or a System Manager. The sign-in page SHALL look exactly as it
does without test mode, with the same labels, the same hint and a password
field, and SHALL NOT say that test mode is on, so the shortcut is known only to
those who need it. A typed password SHALL NOT be logged.

Because the service is not asked, it cannot report that someone has left.
While test mode is on, a person who has left is refused only when their
account is disabled; the instance that runs test mode SHALL keep leavers'
accounts disabled. Test mode is for a trial instance and SHALL NOT be switched
on where real users sign in.

#### Scenario: Open the report as a Team Leader during a trial

- **WHEN** test mode is on and the tester types a Team Leader's employee code
  with any password
- **THEN** they are signed in as that Team Leader and the service is not
  contacted

#### Scenario: Test mode does not widen who can sign in

- **WHEN** test mode is on and the employee code belongs to no one, to a
  disabled account, to a System Manager, or to a person whose link to the
  service has ended
- **THEN** sign-in is refused exactly as it would be with the service asked

#### Scenario: A code on two records

- **WHEN** test mode is on and the typed employee code is current on two
  people's records
- **THEN** sign-in is refused, and neither person is chosen

#### Scenario: Only a development, test or staging server accepts test mode

- **WHEN** the switch is set on a server that is not configured as
  development, test or staging
- **THEN** the server does not start, and says why

#### Scenario: A hosted trial instance runs as staging

- **WHEN** a hosted trial instance is configured as staging with the switch set
- **THEN** it starts with test mode on, and it is otherwise treated as
  production: the Administrator gets no default password

#### Scenario: Anything but the exact switch value leaves it off

- **WHEN** the switch holds a value such as "1" or "true"
- **THEN** the service is asked and a password is required, as without test
  mode

#### Scenario: The page does not advertise it

- **WHEN** test mode is on and a service is connected
- **THEN** the sign-in form shows the ordinary labels, hint and password
  field, and no test-mode notice
