# Sign In and Accounts

## Purpose

A person gets into Featherbase with a username or email and a password, with
their Google account, or with their ID at a connected outside service such as
the organisation's HR system, and stays signed in without repeating that on
every visit. One account stands for one person, whichever of their linked ways
in they use, and administrators decide who may come in, how, and when that
access ends.

## Requirements

### Requirement: Sign in with a password

Signing in SHALL check a username or email, ignoring capital letters, against
a password.

#### Normative details for the whole requirement

When what was typed is one person's username and another
person's email, the username wins; when it names two different people equally
— one person's account ID and another's username — nobody is signed in. A
username can never be set to another person's ID, username or email. A failed
attempt SHALL be refused with the same generic message whether the account
doesn't exist, the password is wrong, or the account can't sign in this way,
so it never reveals which.

#### Scenario: Wrong password

- **WHEN** a user signs in with an account that exists but the wrong password
- **THEN** they are refused with a generic invalid-credentials message

#### Scenario: Two people named equally

- **WHEN** what was typed is one person's account ID and another person's
  username
- **THEN** the attempt is refused like a wrong password, whichever password
  was typed

#### Scenario: Username beats email

- **WHEN** one account's username is "meena" and another account's email is
  "meena", and someone signs in as "meena"
- **THEN** only the first account's password is checked

### Requirement: Repeated sign-in attempts are slowed

Featherbase SHALL refuse further sign-in attempts for a while once too many
have failed for the same name from the same place, and SHALL tell the person
to try again later. A successful sign-in clears the count. Each way in that
takes a typed name counts its own attempts.

#### Scenario: Guessing a password

- **WHEN** someone types a wrong password for the same account five times in
  a quarter of an hour
- **THEN** the next attempt is refused without checking the password, and
  they are told to try again later

### Requirement: Sign in with Google

Featherbase SHALL let a user sign in with their Google account.

#### Normative details for the whole requirement

A Google
account that is linked to a person opens that person's account; any other
Google account is handled by the rule an administrator chose for people
Google does not recognise. While Google sign-in lists allowed domains, a
link that person made themselves, or that the domain rule made, SHALL open
the account only while that rule still admits the account; a link an
administrator made, or an invite the person claimed, SHALL keep opening it.
When a change to the allowed domains stops admitting such a link, the
sessions opened through that link SHALL end; sessions opened another way
SHALL NOT.

#### Scenario: First-time sign-in from an allowed domain

- **WHEN** someone with no Featherbase account signs in with a Google account
  belonging to an allowed company domain
- **THEN** an account is created for them and they are signed in

#### Scenario: Domain not allowed

- **WHEN** someone with no Featherbase account signs in with Google using an
  address from a domain that isn't allowed
- **THEN** they are refused and told to contact IT

#### Scenario: A domain is removed from the list

- **WHEN** a person who linked a Google account on a domain signs in with it
  after an administrator removed that domain from the allowed list
- **THEN** they are refused and told to contact IT, and the link is kept, so
  adding the domain back lets them in again

#### Scenario: Removing a domain ends sessions through it

- **WHEN** an administrator removes a domain while a person is signed in
  through a Google account they linked on that domain
- **THEN** that session ends on its next request, a session the same person
  opened with their password stays open, and adding the domain back does not
  reopen the ended session

#### Scenario: An administrator's link outside the list

- **WHEN** an administrator linked a person's personal Google account and
  that person signs in with it while only a company domain is allowed
- **THEN** they are signed in

#### Scenario: Narrowing the list would lock out a System Manager

- **WHEN** an administrator removes the only domain through which a System
  Manager can still sign in
- **THEN** the change is refused and names the System Manager

### Requirement: Return to where they were headed

Signing in from a link to a specific page SHALL land the user back on that
exact page, not just the general landing page, whichever way they sign in.
Only a page of this site is ever returned to.

#### Scenario: Sign in from a deep link

- **WHEN** a signed-out user follows a link to a specific record and then
  signs in
- **THEN** they land on that record, not on the general landing page

#### Scenario: Sign in with Google from a deep link

- **WHEN** a signed-out user follows a link to a specific settings page and
  signs in with Google
- **THEN** they land on that settings page after Google sends them back

### Requirement: Stay signed in

Once signed in by any supported method, a user SHALL stay signed in across visits and browser-based features for as long as the session length an administrator has set, without re-entering credentials each time.

#### Scenario: Return within the session length

- **WHEN** a signed-in user closes and reopens the browser before their session length has passed
- **THEN** they are still signed in

#### Scenario: Browser features use the full session length

- **WHEN** an administrator chooses a session length shorter or longer than seven days and the user signs in with a password, Google, or a preview link
- **THEN** private files and live updates remain available until that configured session length ends

### Requirement: Reset a forgotten password

Requesting a password reset SHALL always give the same confirmation, whether
or not the account exists, and SHALL email a reset link only to an account
that has both an email address and a password. The link works once and stops
working after an hour or after it's used, whichever comes first.

#### Scenario: Request a reset

- **WHEN** a user asks to reset the password for an email that has no
  account
- **THEN** they see the same confirmation as someone whose account does
  exist, and no email is sent

#### Scenario: Account that signs in elsewhere

- **WHEN** someone asks to reset the password of an account that signs in
  only through the HR system
- **THEN** they see the same confirmation, no email is sent, and the account
  gets no password

#### Scenario: Reuse a spent link

- **WHEN** a user follows a reset link a second time after already setting a
  new password with it
- **THEN** the second attempt is refused

### Requirement: Sign out

Signing out SHALL end that session immediately, everywhere it is used, even if the session was already invalid or expired. The same person's sessions on other devices SHALL stay signed in.

#### Scenario: Sign out ends access

- **WHEN** a signed-in user signs out and then tries to go back
- **THEN** they are asked to sign in again

#### Scenario: A copy of the signed-out session stops working

- **WHEN** someone kept a copy of a user's session and the user signs out
- **THEN** the copy is refused from then on, and its live updates stop within about a minute

#### Scenario: Sign-out that could not finish is said

- **WHEN** a user signs out but the system cannot record it
- **THEN** the user is told sign-out did not complete and stays signed in to try again

#### Scenario: Other devices stay signed in

- **WHEN** a user signed in on two phones signs out on one of them
- **THEN** the other phone stays signed in

### Requirement: Who may sign in

Only a person an administrator has enabled SHALL be able to sign in
interactively, by any of their linked sign-in methods. A disabled person
SHALL be refused every way. An automation account created for scripts is not
a person: it has no sign-in method, needs no email, and authenticates only
with its access token.

#### Scenario: A disabled account can't sign in

- **WHEN** a disabled person tries to sign in, by password, by Google or
  through a connected service
- **THEN** they are refused

#### Scenario: An automation account is not a person

- **WHEN** an administrator looks for an automation account where people are
  chosen, such as assigning a task or sharing a row with a person
- **THEN** it is not offered; it appears only in the list of automation
  accounts

### Requirement: One person, several ways to sign in

An account SHALL stand for one person, who may have several sign-in methods
linked to it, such as an HR system ID, a Google account and a password. A
sign-in method is a way in that an administrator has set up, such as Google or
the organisation's HR system. Every linked method opens the same account, with
the same roles, data access and history.

#### Scenario: Same person through two methods

- **WHEN** a Team Leader whose HR system ID and Google account are both linked
  to their account signs in with Google on Monday and with their HR system ID
  on Tuesday
- **THEN** both times they open the same account and see the same report and
  history

### Requirement: Email is optional

A person SHALL be able to have an account, and sign in, without an email
address. When an account has an email address, no other account may have the
same one, ignoring capital letters. A placeholder address that can never
receive mail, one ending in ".invalid", is refused.

#### Scenario: Store staff without email

- **WHEN** an administrator adds a store staff member with an HR system ID and
  no email address
- **THEN** the account is saved with no email and the person can sign in with
  their HR system ID

#### Scenario: Same address in different capitals

- **WHEN** an administrator gives an account the address "Asha@Example.com"
  while another account already has "asha@example.com"
- **THEN** the save is refused because the address is already in use

### Requirement: Matched by the provider's permanent ID

A sign-in through an outside provider that keeps a permanent ID for the
person, such as Google's account ID, SHALL be recognised by that ID only. A
changed email or name at the provider does not change whose account opens,
and an email address that matches an existing account never links a sign-in
to it on its own; only an administrator's invite or mark for that person
does.

#### Scenario: Google address changes

- **WHEN** a person whose Google account is linked changes that account's
  address and signs in with Google again
- **THEN** they open their own account as before

#### Scenario: Someone else's address

- **WHEN** a Google account that is not linked to anyone signs in, and its
  address equals the email on an existing account that has no invite or mark
  for it
- **THEN** it does not open that existing account, and the sign-in is refused

### Requirement: Rule for people a method does not know

Each sign-in method SHALL follow the rule an administrator chose for a person
it does not recognise: make an account for them, make one only when the
method vouches for an email address on an allowed domain, make one only when
the person is on the staff roster and the HR system confirms them, or refuse.
A method that cannot vouch for a permanent ID, such as the HR system, can
never make an account for just anyone. A new account starts with no access
beyond what every signed-in person has.

#### Scenario: Google with allowed domains

- **WHEN** Google's rule is to admit only allowed domains and someone unknown
  signs in with a Google account belonging to an allowed company domain
- **THEN** an account is made for them, linked to their Google account, and
  they are signed in

#### Scenario: The HR system cannot make accounts

- **WHEN** an administrator tries to set the HR system's rule to make an
  account for people it does not know
- **THEN** the change is refused, because the HR system cannot vouch for who
  someone is

#### Scenario: Only the HR system can use the staff roster

- **WHEN** an administrator tries to set the staff roster rule on Google or on
  password sign-in, or on the HR system without saying where the roster is
- **THEN** the change is refused

### Requirement: Sign up with a username and password

When an administrator has opened sign-up, a visitor SHALL be able to create an
account by choosing a username and a password, and is signed in straight
away. Sign-up asks for nothing else. It is closed unless an administrator
opens it.

#### Scenario: Sign up while it is open

- **WHEN** sign-up is open and a visitor chooses an unused username and a
  password
- **THEN** their account is created with no email and they are signed in

#### Scenario: Sign-up closed

- **WHEN** sign-up is closed and someone tries to create an account
- **THEN** the sign-in page offers no sign-up and the attempt is refused

### Requirement: An administrator links sign-in methods

An administrator who manages the system SHALL be able to link a sign-in method
to any person, change or move a link in one step, and remove one.

#### Normative details for the whole requirement

A Google
account can be invited by its address before the person first signs in: their
first Google sign-in with that address links the account for good, and after
that the address is never used to find them. Any change to the person's email
— set, changed or cleared — cancels every invite they have not yet used,
whatever address it was for; an invite is never claimed for a disabled
account.

#### Scenario: Invite a store manager's Google account

- **WHEN** an administrator invites a Google address to a store manager's
  account and the manager then signs in with that Google account
- **THEN** they open the store manager's account, and later sign-ins are
  recognised by the Google account's permanent ID, not its address

#### Scenario: Invite on a disabled account

- **WHEN** a Google address is invited to an account that has since been
  disabled, and someone signs in with that Google account
- **THEN** they are refused and the invite stays unclaimed

#### Scenario: Email changed before the invite is used

- **WHEN** an administrator changes a person's email after inviting their old
  Google address
- **THEN** the old invite is cancelled and signing in with that Google account
  no longer opens the person's account

### Requirement: A person links another method themselves

A signed-in person SHALL be able to link another sign-in method to their own
account by proving it, for example by completing a Google sign-in, where an
administrator allows it for that method. They must have signed in within the
last few minutes, and a method already linked to someone else is refused.
Where the method lists allowed domains, the account SHALL pass the same
domain rule as a first sign-in, or the link is refused and nothing changes.

#### Scenario: Add Google to an HR system account

- **WHEN** a Team Leader who just signed in with their HR system ID chooses to
  link a Google account and completes Google's sign-in
- **THEN** that Google account is linked and later opens the same account

#### Scenario: Already someone else's

- **WHEN** a person tries to link a Google account that is already linked to a
  different account
- **THEN** the link is refused and neither account changes

#### Scenario: A personal account where only the company domain is allowed

- **WHEN** a person tries to link a personal Gmail account while Google
  sign-in allows only the company domain
- **THEN** the link is refused, nothing is linked, and the sign-in methods
  page says the account is not on a domain the site allows

### Requirement: Some sign-ins cannot change access

A session that cannot vouch for the person SHALL NOT add or remove access to
the account: it cannot link or remove a sign-in method, set a password, or
create an access token. That covers a test-mode sign-in and a preview link's
click-through sign-in. Such a session can still read until it expires.

#### Scenario: Tester tries to keep a way in

- **WHEN** a tester who signed in as a Team Leader through test mode tries to
  set a password on that account or link their own Google account to it
- **THEN** both are refused and the account is unchanged

### Requirement: Removing a sign-in method

A person SHALL be able to remove a sign-in method from their account, except
their last working one; a pending invite does not count as a way in.
Removing a method, or an administrator turning a method off, ends the sessions
opened with it.

#### Scenario: Remove the last method

- **WHEN** a person with only one sign-in method tries to remove it
- **THEN** they are refused and told to add another way in first

#### Scenario: Method turned off

- **WHEN** an administrator turns Google sign-in off while people are signed
  in with Google
- **THEN** their next action asks them to sign in again

### Requirement: Administrators are never locked out

Featherbase SHALL refuse any change that would leave an enabled Administrator
or System Manager who can sign in now with no way in: turning off, removing or
unconfiguring a sign-in method, or removing or moving one of their links. A
connected service never counts as their way in, because they never sign in
through it.

#### Scenario: Turn off passwords

- **WHEN** a System Manager tries to turn off password sign-in while the
  Administrator signs in only with a password
- **THEN** the change is refused and names who would be locked out

#### Scenario: Remove a password beside an HR system link

- **WHEN** a System Manager whose other link is their HR system ID tries to
  remove their own password
- **THEN** they are refused, because the HR system never signs them in

### Requirement: Sign in through a connected service

When an administrator has connected an outside sign-in service, such as the
organisation's HR system, the sign-in page SHALL open on that service's form,
because most people who sign in there are store staff who know only their
employee ID.

#### Normative details for the whole requirement

The person types their ID in that service and its password;
Featherbase asks that service to check them and never keeps, logs or shows the
password. The page's other ways in (Google, another connected service, an email
or username and a password) sit under the form, one tap away.

#### Scenario: Sign in with an HR system ID

- **WHEN** the HR system is connected, the user's account is linked to their
  HR system ID, and they sign in with that ID and their HR system password
- **THEN** they are signed in and land where a password sign-in would take
  them

#### Scenario: The service's form comes first

- **WHEN** someone opens the sign-in page while the HR system is connected
- **THEN** the page shows the HR system's ID and password boxes first, and
  offers "Sign in with Google" and "Use email and password instead" under them,
  when those ways are on

#### Scenario: Wrong password at the service

- **WHEN** the service says the password is wrong
- **THEN** the user is refused with the same message as a wrong Featherbase
  password, and is not signed in

### Requirement: One linked account per service ID

A sign-in through a connected service SHALL only ever sign in the one account
that the typed service ID is linked to, ignoring case and surrounding spaces.
An ID with no linked account is refused exactly like a wrong password, and its
password is never sent to the service. One service ID can be linked to only
one account.

#### Scenario: No account linked yet

- **WHEN** a user types an ID that no account is linked to
- **THEN** they get the same refusal as a wrong password, and the service is
  never asked whether their password is right

#### Scenario: Linking an ID that is already taken

- **WHEN** an administrator links a service ID that is already linked to
  another account
- **THEN** the link is refused and the existing link is unchanged

### Requirement: An outage is not a wrong password

When the connected service does not answer, answers with its own failure, or
takes too long, the user SHALL be told the service is unavailable — never that
their password is wrong.

#### Scenario: The service is down

- **WHEN** the user signs in through the service while it is not answering
- **THEN** they are told the service is unavailable and to try again later

### Requirement: No fallback during an outage

When a connected sign-in service is not answering, Featherbase SHALL NOT try
another way to sign the person in with what they typed, such as a password it
holds itself.

#### Scenario: HR system down

- **WHEN** the HR system is down and a person who also has a Featherbase
  password signs in with their HR system ID
- **THEN** they are told the HR system is unavailable and are not signed in

### Requirement: Off until connected

Until an administrator connects the service and turns it on, the sign-in page
SHALL show no second way in, and attempts to use it SHALL be answered as if it
does not exist, without contacting any outside service.

#### Scenario: Nothing connected

- **WHEN** no service is connected and someone tries to sign in through it
- **THEN** the attempt is answered as not found and no outside service is
  contacted

### Requirement: Only a clear yes signs anyone in

A connected service SHALL sign a user in only when its answer clearly says the
password is right; an empty, unreadable or unfamiliar answer SHALL be treated
as the service not answering, never as a sign-in.

#### Scenario: The service answers with a page it does not normally send

- **WHEN** the service answers a sign-in with an empty reply or a web page
- **THEN** the user is told the service is not responding and is not signed in

### Requirement: Administrators use their own password

The Administrator and System Managers SHALL never be signed in through a
connected service, so whoever runs that service cannot reach them by resetting
a password there.

#### Scenario: A System Manager has a linked ID

- **WHEN** an ID linked to a System Manager is typed with its HR password
- **THEN** the sign-in is refused like a wrong password

### Requirement: Someone who has left is refused everywhere

When a connected service reports that a person has left, Featherbase SHALL
refuse the sign-in even when the password is right, disable their account and
end all their sessions, keeping the account's history. Every other way in
then refuses them too.

#### Scenario: Leaver who also has a password

- **WHEN** someone who has left signs in with their still-working HR system
  password, and later tries their Featherbase password
- **THEN** they are told the account is no longer active, both are refused,
  and the account is disabled with its history kept

### Requirement: Test mode for sign-in through a connected service

A deployment MAY switch on test mode for sign-in through a connected service,
only through its server environment and only with an exact switch value, and
only on a development, test or staging server — staging being a hosted trial
instance that is a production server in every other respect: any other server
refuses to start with it set.
A typed password SHALL NOT be logged.

#### Normative details for the whole requirement

While it is on, the service SHALL NOT be asked:
a tester signs in as a person by typing the employee code on that person's
record, in any mix of capitals, with any password or none. The code must
belong to exactly one person, and that person must have a live, unended link
to the service; who may sign in is otherwise unchanged — one enabled account,
and not the Administrator or a System Manager. The sign-in page SHALL look
exactly as it does without test mode and SHALL NOT say that test mode is on,
so the shortcut is known only to those who need it.

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

#### Scenario: The service login name is not the test-mode ID

- **WHEN** test mode is on and the tester types the person's login name at the service
- **THEN** sign-in is refused; test mode looks people up by employee code only

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

### Requirement: A refused sign-in is explained on the sign-in page

A sign-in that the browser reaches by navigation, such as the Google sign-in
and its return from Google, SHALL NOT show a raw error.

#### Normative details for the whole requirement

When it is refused,
the browser SHALL go back to the sign-in page with a short reason, and the
page SHALL explain it in one plain sentence that says what to do next (ask
their manager or IT, try again, or use another way in) and reveals nothing
else: no address, no domain, and no detail of the account. A caller that does
not ask for a page, such as a script, SHALL get the error as before.

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

- **WHEN** the same refusal reaches a caller that did not ask for a page
- **THEN** it gets the error response and status it got before

### Requirement: A refused sign-in offers the next step

After a refused Google sign-in, the sign-in page SHALL show the reason with a
short choice of next steps instead of an empty form: sign in through the
connected service when one is on (the main choice), try another Google account
with Google's account chooser shown, or see the other ways in. No input field
is shown until the person picks one, and once they have, a reload shows the
usual sign-in rather than the refusal again.

#### Scenario: The person picks a next step

- **WHEN** a refused Google sign-in comes back while the HR system is
  connected, and the person picks the HR system, another Google account, or
  the other ways in
- **THEN** they get the HR system's form, a new Google sign-in that lets them
  choose the account, or the usual ways in with the reason still shown above
  them

#### Scenario: No connected service

- **WHEN** the same refusal comes back and no connected service is on
- **THEN** trying another Google account is the main choice

### Requirement: The sign-in forms never show a raw server message

A sign-in form SHALL check that the fields it needs are filled before it
sends anything, and say plainly what to enter when they are not.

#### Normative details for the whole requirement

It SHALL
send what is in the boxes when it is submitted, including values the
browser's autofill wrote, and SHALL NOT show example text that could pass for
a filled-in value. A server message SHALL be shown only when it is worded for
people, such as a wrong password, an outage or someone who has left; a message
about the request's shape, or an unexpected failure, SHALL read as a plain
sentence.

#### Scenario: Submitted empty

- **WHEN** someone submits the password form with an empty field
- **THEN** it tells them to enter their email or username and their password,
  and sends nothing

#### Scenario: The server answers with a request-shape message

- **WHEN** the server answers a sign-in with a validation message about the
  request's shape, or with an unexpected failure
- **THEN** the page shows a plain sentence instead, never the server's text

### Requirement: Open a preview with one link

A preview deployment MAY be given one secret link that signs the visitor
straight in as a named, non-Administrator person, so a feature can be judged
as that person would see it. It SHALL be off unless both the link's secret and
the person are configured, the secret must be long, and a wrong or missing
secret SHALL be answered as if the page did not exist.

#### Scenario: Follow the preview link

- **WHEN** an owner opens the preview's link with the right secret
- **THEN** they are signed in as the configured person, with that person's
  own roles

#### Scenario: Wrong secret

- **WHEN** someone opens the link with a wrong secret, or previews are off
- **THEN** they are told the page does not exist and are not signed in

### Requirement: An account's permanent reference is never an address or a code

Every person's account SHALL be identified for good by a reference
Featherbase assigns, which never changes and is not the person's email
address, username or employee code, however the account came to exist. Those
can change or be reused; the reference cannot.

#### Scenario: A person created by a Google sign-in changes their address

- **WHEN** someone's account was created by their first Google sign-in and
  they later move to a new Google address
- **THEN** their account, its history and everything that refers to it are
  unchanged; only their contact address is updated, unless it was set by hand
  or another person already uses the new address

#### Scenario: Renaming is refused

- **WHEN** an administrator tries to rename a person's permanent reference
- **THEN** the change is refused and they are told to change the name instead

#### Scenario: Trial accounts get their permanent reference

- **WHEN** the trial instance is upgraded and its accounts, until now
  identified by employee codes and addresses, receive permanent references
- **THEN** every person keeps their roles, access, history and sign-in
  methods, signs in once more, and nothing in Featherbase still refers to the
  old identifiers

#### Scenario: The sign-in page says why

- **WHEN** someone whose session ended — at the upgrade, or because their
  account was disabled — opens Featherbase
- **THEN** the sign-in page tells them their session has ended and asks them
  to sign in again

#### Scenario: Names, never permanent references, on screen

- **WHEN** a person's permanent reference would appear on a screen — a
  comment's author, a list of people, a picker, a token's owner
- **THEN** their name is shown instead (or their username, address or
  employee code where they have no name), and the reference itself never is

### Requirement: Existing sign-ins carry over

When linked sign-in methods were introduced, everyone who could sign in before
SHALL keep signing in the same way without doing anything, after signing in
once more.

#### Normative details for the whole requirement

A person who had already signed in with Google gets a one-time
link: their next Google sign-in with the same address links their Google
account's permanent ID, and from then on the address is never used to find
them. Before the upgrade an administrator can list what it will do, including
a check that everyone who can sign in today keeps a way in.

#### Scenario: Store staff the morning after

- **WHEN** a Team Leader signs in with their HR system ID, typed in any mix
  of capitals, the day after the upgrade
- **THEN** they open the same account and report as the day before

#### Scenario: First Google sign-in after the upgrade

- **WHEN** a person who used to sign in with Google signs in with it for the
  first time after the upgrade
- **THEN** they open their own account, and their Google account is linked to
  it by its permanent ID

#### Scenario: Signed in before the upgrade

- **WHEN** a person who was signed in before the upgrade opens Featherbase
  after it
- **THEN** they are asked to sign in, and then see what they saw before

### Requirement: Reset a password from the server when locked out

Someone who can open a shell on the server SHALL be able to set a new password for any person, so the instance can be recovered when no administrator can sign in. The old password stops working at once.

#### Scenario: Recover a locked-out administrator

- **WHEN** no administrator can sign in and the operator sets a new password for the administrator from the server
- **THEN** the administrator signs in with the new password, and the old one is refused

### Requirement: Keep the new password out of sight

The new password SHALL be accepted only when it is passed in out of sight, never written on the command line or typed where it would show on screen, and it is never printed back.

#### Scenario: Password written on the command line

- **WHEN** the operator writes the new password on the command line itself
- **THEN** the reset is refused and the password is not shown in the reply

#### Scenario: Password typed at a terminal

- **WHEN** the operator runs the reset at a terminal without passing the password in
- **THEN** the reset is refused and asks for the password to be passed in instead

### Requirement: Refuse resets that cannot apply

The reset SHALL be refused, and nothing changed, for a person who does not exist, for a service account, which has no password, and for a password shorter than the minimum that sign-up and the emailed reset use.

#### Scenario: Unknown person

- **WHEN** the operator resets the password of someone who does not exist
- **THEN** the reset is refused with a message that the person was not found

#### Scenario: Service account or short password

- **WHEN** the operator resets a service account's password, or gives a password of three letters
- **THEN** the reset is refused and no password changes

### Requirement: Sign the person out everywhere

A reset from the server SHALL end every session the person had open before it, to the second, while sign-ins made after it and other people's sessions carry on.

#### Scenario: A stolen session ends

- **WHEN** the person was signed in on another device before the reset
- **THEN** that device is asked to sign in again on its next request

#### Scenario: Signing in straight after

- **WHEN** the person signs in with the new password within the same second as the reset
- **THEN** they stay signed in, and other people stay signed in too

### Requirement: Access tokens keep working

A reset from the server SHALL leave the person's access tokens working, and the operator SHALL be told how to list and revoke them if the account may be compromised.

#### Scenario: A script keeps running

- **WHEN** a script uses the person's access token after their password was reset from the server
- **THEN** the script still works, and the operator was shown how to revoke the token

### Requirement: Earlier reset links stop working

A reset from the server SHALL make every reset link emailed to the person before it unusable, even one opened at the same moment, so the recovery cannot be undone by an old email.

#### Scenario: Old reset email

- **WHEN** someone follows a reset link that was emailed before the reset from the server
- **THEN** the link is refused and the password set from the server still works

### Requirement: Record who reset the password

Each reset from the server SHALL leave an entry in the Activity Log that names the server operator as the one who did it and the person whose password was set.

#### Scenario: Audit a recovery

- **WHEN** an administrator looks through the Activity Log after a recovery
- **THEN** they see a password set by the server operator for that person

### Requirement: Publish the instance's privacy notice

An administrator SHALL be able to set the instance's own privacy notice, and
anyone SHALL be able to read it on a public page without signing in. Until a
notice is set, the page SHALL not exist. Formatting in the notice, such as
headings, lists and links, SHALL show as formatting; anything that could run
in the reader's browser SHALL be shown as plain text or dropped, and the page
SHALL load nothing from elsewhere, so an image in the notice shows as a link.

#### Scenario: Read the notice before signing in

- **WHEN** an administrator has set a notice and a visitor who is not signed in opens the privacy page
- **THEN** they see the notice, with its headings and links

#### Scenario: No notice set

- **WHEN** no notice has been set and someone opens the privacy page
- **THEN** they are told the page does not exist

### Requirement: See who is waiting for access

A person SHALL wait for an app only after opening it without access: an installed app's pages, Dash or
Featherbase. Opening it SHALL record one request per person and app and say "You don't have access to <App>
yet. An admin has been told." A System Manager SHALL see them as a standard list, newest first, with each
person's full email address and an App column to filter by. A request SHALL leave the list once that person can open
that app; the menu count SHALL count the same rows.

#### Scenario: Opening an app without access

- **WHEN** Priya, who holds only Tasker Member, opens Dash
- **THEN** she sees "You don't have access to Dash yet. An admin has been told."
- **AND** a System Manager sees her on the waiting list with App "Dash" and her email address, and the menu
  count goes up by one

#### Scenario: An app she can open is not a request

- **WHEN** Priya opens Tasker, which she can use
- **THEN** she is not listed as waiting for Tasker

#### Scenario: A new starter shows up

- **WHEN** someone from an allowed company domain signs in with Google for the first time, holding no role
- **THEN** they are not on the waiting list until they open something they have no access to
- **AND** once Featherbase has told them they have no access, a System Manager sees them on the waiting list with
  App "Featherbase"

#### Scenario: Opening it again

- **WHEN** Priya opens Dash again while still waiting
- **THEN** she is listed once for Dash

#### Scenario: Giving a role takes them off the list

- **WHEN** a System Manager gives Priya a role that opens Dash
- **THEN** her Dash request no longer shows, and any request of hers for another app still does

#### Scenario: The waiting list works like any list

- **WHEN** a System Manager filters the waiting list by App "Featherbase" or chooses which columns show
- **THEN** the list narrows and shows those columns the way every other list does, and only waiting requests are
  ever listed

#### Scenario: Only System Managers see the list

- **WHEN** someone who is not a System Manager tries to open the waiting list
- **THEN** they are refused and see no count in their menu

### Requirement: Email an invitation to sign in

Inviting a person's Google address SHALL email that address, unless the
administrator chooses not to. The email says who invited them and what this
service is, in the organisation's own words, links to the sign-in page, and
says to sign in with Google using that address. Inviting an address that is
already invited sends nothing.

#### Scenario: A new invite is emailed

- **WHEN** an administrator invites a person's Google address
- **THEN** that address receives one email naming the administrator and the
  service, with a link to sign in with Google using that address

#### Scenario: The administrator opts out

- **WHEN** an administrator invites an address and chooses not to send an email
- **THEN** the invite is made and no email is sent

#### Scenario: The address is already invited

- **WHEN** an administrator invites an address that already has a pending invite
- **THEN** no further email is sent

### Requirement: A failed invitation email is reported

When the invitation email cannot be sent, the invite SHALL still be made, and
the administrator SHALL be told that the email did not go out.

#### Scenario: The mail server refuses

- **WHEN** an administrator invites an address and the email cannot be sent
- **THEN** the invite is listed as pending and the administrator sees that the
  email was not sent

### Requirement: Send an invitation again

An administrator SHALL be able to send a pending invite's email again, but not
within ten minutes of the last one. Only an administrator who manages the
system SHALL be able to do this, and a send that fails SHALL be reported as a
failure.

#### Scenario: Resend by someone who does not manage the system

- **WHEN** a user who does not manage the system tries to send an invitation again
- **THEN** they are refused and no email is sent

#### Scenario: The resent email cannot be sent

- **WHEN** an administrator sends an invitation again and the email cannot be sent
- **THEN** they are told the service could not send it, and can try again at once

#### Scenario: Resend too soon

- **WHEN** an administrator sends an invitation again minutes after it was sent
- **THEN** no email is sent and they are told to try again later

### Requirement: People who have left lose access

Once a day, Featherbase SHALL disable every person linked to a StyleHR employee record that shows they have left: an exit date that has passed, an inactive status, or not being on the latest payroll. A disabled person's sessions end at once. The check SHALL never re-enable anyone and SHALL never disable a System Manager; it reports them instead.

#### Scenario: A leaver is turned away

- **WHEN** the StyleHR record of a signed-in store employee shows an exit date that passed yesterday
- **THEN** after the next daily check their next request asks them to sign in, signing in is refused, and the activity log says they were disabled because their exit date had passed

#### Scenario: A System Manager is reported, not disabled

- **WHEN** a System Manager's StyleHR record shows they have left
- **THEN** they keep their access and the other System Managers are told by email to decide

### Requirement: A bad feed disables nobody

The daily check SHALL disable nobody when the StyleHR data it reads is more than a day old, or when it would disable more than one in twenty linked people at once. System Managers are told why.

#### Scenario: The warehouse stopped loading StyleHR

- **WHEN** the warehouse's latest StyleHR day is three days old
- **THEN** the check disables nobody and the System Managers get an email saying the feed is stale

### Requirement: A notice with nobody to receive it is recorded

When a system notice, such as the leaver-check summary or a waiting-for-access alert, has no System Manager with an email address to go to, the system SHALL record that it reached nobody instead of dropping it silently. Before a release, the system SHALL warn, without stopping the release, when no System Manager other than the built-in Administrator has an email address.

#### Scenario: No System Manager has an email address

- **WHEN** someone signs in for the first time and no System Manager has an email address
- **THEN** the activity log shows that the alert reached nobody, and why

#### Scenario: A new instance is released

- **WHEN** an instance whose only System Manager is the built-in Administrator is released
- **THEN** the release goes ahead and warns that alerts will reach nobody until a System Manager has an email address

### Requirement: Link a first Google sign-in to a person who expects it

An administrator who manages the system SHALL be able to mark a person as
expecting Google sign-in. That person's first Google sign-in SHALL link to
them only when Google has verified the address, it is the person's own
address on a domain Google sign-in admits, the person is enabled and has no
Google sign-in yet; after that the link is permanent and the mark is used up.

#### Scenario: The expected person signs in

- **WHEN** an administrator marks a person as expecting Google sign-in, and
  that person signs in with Google using their own verified work address
- **THEN** they are signed in to their own account, and the activity log
  records that the system linked their Google sign-in

#### Scenario: The same address from another Google account later

- **WHEN** a person's first Google sign-in has linked to them, and later a
  different Google account with the same address signs in
- **THEN** it is refused because the address is already in use

#### Scenario: A person who is not marked

- **WHEN** someone signs in with Google using the address of a person who is
  not marked as expecting it
- **THEN** they are refused because the address is already in use, as before

#### Scenario: Someone who does not manage the system

- **WHEN** a user who can edit people but does not manage the system tries to
  mark a person as expecting Google sign-in
- **THEN** they are refused and the person is unchanged

### Requirement: Each sign-in records where it came from

Every sign-in SHALL record the network address it came from, whichever way the
person signed in, so an administrator can see from where an account was used.
An address the person's browser could have made up is never recorded as theirs.

#### Scenario: See where a sign-in came from

- **WHEN** the user signs in with their password from the shop's network
- **THEN** the administrator finds the sign-in in the Activity Log with the
  shop's public address

#### Scenario: A made-up address is not believed

- **WHEN** someone signs in with a request that claims to come from another
  address
- **THEN** the Activity Log shows the address the request really came from

### Requirement: A session travels only over a secure connection

On an instance reached at a secure address, the browser SHALL be told to send the user's session only over a secure connection, so it never crosses the network in the clear. A developer's own plain local address keeps signing people in as before.

#### Scenario: Signing in at a secure address

- **WHEN** the user signs in to an instance at a secure address
- **THEN** their browser sends the session only over secure connections

#### Scenario: Signing in on a local development address

- **WHEN** a developer signs in on a plain local address
- **THEN** they are signed in and stay signed in

### Requirement: The sign-in page carries the instance's own name and logo

The sign-in page SHALL show the instance's name and, when an administrator has
set one in System Settings, the instance's own logo; without one it shows the
Featherbase mark. The logo is shown before sign-in only when it is an image this
instance serves publicly, and a settings file never manages it, because the file
lives in one instance's own storage.

#### Scenario: A store's own logo

- **WHEN** an administrator uploads the business's logo to System Settings and
  someone opens the sign-in page
- **THEN** the page shows that logo above the instance's name

#### Scenario: No logo set

- **WHEN** no logo is set
- **THEN** the sign-in page shows the Featherbase mark above the instance's name

### Requirement: Rotating IPv6 addresses does not reset sign-in limits

Sign-in attempt limits SHALL treat IPv6 addresses in the same /64 network as one source. Sign-in history SHALL still record the full address used.

#### Scenario: Rotate within one network

- **WHEN** the user exhausts sign-in attempts and changes to another IPv6 address in the same /64 network
- **THEN** further attempts are refused until the budget resets

#### Scenario: Another network has its own budget

- **WHEN** the user signs in from a different IPv6 /64 network
- **THEN** it has a separate attempt budget and history records the full sign-in address

### Requirement: An administrator reads a linked Google account by its address

On a person's sign-in methods, a linked Google account SHALL lead with its address and SHALL say when and
how it was linked and when it was last used. Google's account number SHALL be shown only when asked for,
never as the first thing the row says.

#### Scenario: A claimed Google invite reads as who and when

```gherkin
Given a person was invited by a Google address and has signed in with it
When a System Manager opens the person's sign-in methods
Then the Google sign-in leads with the person's address
And it says it was linked at first sign-in, and when it was last used
And Google's account number shows only under the sign-in's details
```

### Requirement: Staff start using the system at their first HR sign-in

Someone on the staff roster with no account SHALL be able to sign in with their
HR system ID and password. Their first sign-in makes their account, links their
sign-in and marks the roster row as theirs, all together or not at all. Each
later sign-in uses that account.

#### Scenario: A first sign-in

- **WHEN** the HR system's rule is the staff roster, the user's ID is on one
  current roster row that nobody holds, and the HR system confirms the password
  and names that row's record
- **THEN** the user is signed in to a new account with no roles, which is linked
  to the row and holds their employee identifiers

#### Scenario: A later sign-in

- **WHEN** the user who signed in that way signs in again
- **THEN** they are signed in to the same account and no other account is made

#### Scenario: The HR system later answers for someone else

- **WHEN** the user signs in again, and the HR system confirms the password but
  names a different record than the one their account was linked to
- **THEN** they are refused as for a wrong password, their account stays as it
  was, and the activity log names the link

#### Scenario: Two first sign-ins at once

- **WHEN** the same user's first sign-in is sent twice at the same moment
- **THEN** one account is made and both sign-ins land on it

### Requirement: The HR system is asked only about someone on the roster

The HR system SHALL be asked to check a password only for an ID that could
become a sign-in, so the system can't be used to test passwords for other IDs.
Everyone refused sees the same wording as a wrong password.

#### Scenario: An ID that is not on the roster

- **WHEN** someone signs in with an ID on no roster row
- **THEN** they are refused as for a wrong password, and the HR system is not
  asked

#### Scenario: Someone who has left

- **WHEN** someone signs in with an ID whose roster row is not current
- **THEN** they are refused as for a wrong password, and the HR system is not
  asked

#### Scenario: A retired roster row

- **WHEN** someone signs in with an ID whose roster row is retired, whatever its
  status says
- **THEN** they are refused as for a wrong password, and the HR system is not
  asked

#### Scenario: Someone the HR system says has left

- **WHEN** someone's roster row is still current, but the HR system confirms the
  password and says they have left
- **THEN** they are refused as for a wrong password, and no account is made

### Requirement: Doubtful cases go to an administrator, never a guess

When an ID is on two roster rows, when its row or its values already belong to
someone, or when the HR system confirms a different record than the row's, the
sign-in SHALL be refused as for a wrong password, nothing SHALL change, and the
activity log SHALL tell an administrator which row or link needs attention,
without the ID, a name or a password.

#### Scenario: Two rows with one ID

- **WHEN** someone signs in with an ID that is on two roster rows
- **THEN** they are refused, the HR system is not asked, and the activity log
  names the row

#### Scenario: The HR system confirms someone else

- **WHEN** the HR system confirms the password but names a different record
  than the roster row's
- **THEN** they are refused, no account is made, and the activity log names the
  row

#### Scenario: Already held

- **WHEN** a person already holds the row's record number or employee code, or
  an ended sign-in carries that record
- **THEN** they are refused, the HR system is not asked, and the activity log
  names the row

### Requirement: Tell System Managers who is asking for access

When a person first asks for an app by opening it without access, every enabled System Manager with an email
address SHALL get one email saying who asked, for which app, and where to give them access. A request still
waiting a day after it was made SHALL be sent again once, in one reminder email to each System Manager listing every
such request. Signing in SHALL NOT send an alert.

#### Normative details for the whole requirement

A failed email SHALL NOT stop the page opening. A day's alerts, counted by the India day, SHALL be capped; the cap
is best-effort, so requests at the same moment can pass it by a few. A request made after the cap is reached SHALL
NOT be emailed about then, but SHALL still show on the waiting list and in the next day's reminder.

#### Scenario: One email per person and app

- **WHEN** Priya opens Dash without access twice, then opens Featherbase without access
- **THEN** each System Manager got exactly two emails about her: one for Dash and one for Featherbase

#### Scenario: A reminder after a day

- **WHEN** Priya's Dash request has waited more than a day and the reminder runs twice
- **THEN** each System Manager got one reminder listing it

#### Scenario: A busy day stops the emails, not the list

- **WHEN** more people ask in one day than the daily cap allows
- **THEN** the later requests are not emailed about that day, and still show on the waiting list

#### Scenario: Mail trouble does not stop the page

- **WHEN** the email cannot be sent as Priya opens Dash
- **THEN** she still sees that an admin has been told, and her request is listed

### Requirement: A connected service must name the linked record

When an administrator has set where a connected service's answer names the person's record, a sign-in through that service SHALL be refused, as for a wrong password, unless the answer names the record the account is linked to. The activity log names the link, and an answer about somebody else never disables this person.

#### Scenario: The HR system answers for someone else

- **WHEN** a Team Leader's account is linked to HR record 7001, and the HR system confirms their password but names record 7002
- **THEN** they are refused as for a wrong password, and the activity log names their link

#### Scenario: The HR system names the linked record

- **WHEN** the HR system confirms the password and names record 7001
- **THEN** the Team Leader is signed in

### Requirement: Staff on the roster are linked before they sign in

The system SHALL give every current row of an HR system's staff roster an
account, a sign-in link and the row's employee identifiers before the person
first signs in, and mark the row as theirs, all together or not at all for each
row, and end the sign-in link of anyone whose roster rows are no longer
current. A link SHALL sign nobody in by itself.

#### Scenario: A current employee is linked before signing in

- **WHEN** the roster link runs and a current roster row has no account
- **THEN** the row gets a new account with no roles, a live sign-in link and
  its employee identifiers, nothing is emailed, and a second run changes nothing

#### Scenario: Someone who already signed in is matched

- **WHEN** the roster link runs for a row whose person already signed in
- **THEN** no account is made and their account stays as it was

#### Scenario: A linked employee still needs their password

- **WHEN** a linked employee signs in outside test mode
- **THEN** the HR system checks the password, and an answer naming a different
  record is refused as for a wrong password

#### Scenario: A case for an administrator is held

- **WHEN** a row's ID is on two roster rows, or its employee code is current on
  another account, or its account is an administrator's
- **THEN** the row is not linked and the activity log notes the row and the
  reason once

#### Scenario: A leaver's link ends

- **WHEN** a linked person's roster row is no longer current, or is retired
- **THEN** their sign-in link ends, the identifiers the roster wrote close, and
  their account is kept

#### Scenario: A run that would end too many links

- **WHEN** a run would end more than the limit of links
- **THEN** it ends none and is reported as refused, and still links new rows
