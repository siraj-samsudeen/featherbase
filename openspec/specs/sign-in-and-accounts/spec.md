# Sign In and Accounts

## Purpose

A person gets into Featherbase with an email or username and a password, or
with their Google account, and stays signed in without repeating that on
every visit.

## Requirements

### Requirement: Sign in with a password

Signing in SHALL check an email or username against a password, and SHALL
refuse with the same generic message whether the account doesn't exist, the
password is wrong, or the account can't sign in this way — so a failed
attempt never reveals which of those it was.

#### Scenario: Wrong password

- **WHEN** a user signs in with an account that exists but the wrong password
- **THEN** they are refused with a generic invalid-credentials message

### Requirement: Sign in with Google

Featherbase SHALL let a user sign in with their Google account. An account
that already exists always signs in this way; a person signing in for the
first time only gets an account made for them if their email's domain is
one an administrator has allowed.

#### Scenario: First-time sign-in from an allowed domain

- **WHEN** someone with no Featherbase account signs in with Google using an
  email from an allowed domain
- **THEN** an account is created for them and they are signed in

#### Scenario: Domain not allowed

- **WHEN** someone with no Featherbase account signs in with Google using an
  email from a domain that isn't allowed
- **THEN** they are refused and told to contact IT

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
or not the account exists, and SHALL email a reset link only when it does.
The link works once and stops working after an hour or after it's used,
whichever comes first.

#### Scenario: Request a reset

- **WHEN** a user asks to reset the password for an email that has no
  account
- **THEN** they see the same confirmation as someone whose account does
  exist, and no email is sent

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

### Requirement: Test mode for sign-in through a connected service

A deployment MAY switch on test mode for sign-in through a connected service,
only through its server environment and only with an exact switch value. While
it is on, the service SHALL NOT be asked: a tester signs in as a person by
typing that person's employee code (their account's ID) and no password — not
the person's login name at the service, which a tester does not know. Who may
sign in is otherwise unchanged — one account that is linked to the service,
enabled, and not the Administrator or a System Manager. The sign-in page SHALL
say that test mode is on and ask for an employee code.

Because the service is not asked, it cannot report that someone has left.
While test mode is on, a person who has left is refused only when their
account is disabled; the instance that runs test mode SHALL keep leavers'
accounts disabled (the roster sync's leaver option). Test mode is for a trial
instance and SHALL NOT be switched on where real users sign in.

#### Scenario: Open the report as a Team Leader during a trial

- **WHEN** test mode is on and the tester types a Team Leader's employee code with no password
- **THEN** they are signed in as that Team Leader and the service is not contacted

#### Scenario: Test mode does not widen who can sign in

- **WHEN** test mode is on and the employee code belongs to no account, to an account not linked to the service, to a disabled account or to a System Manager
- **THEN** sign-in is refused exactly as it would be with the service asked

#### Scenario: The service login name is not the test-mode ID

- **WHEN** test mode is on and the tester types the person's login name at the service
- **THEN** sign-in is refused; test mode looks people up by employee code only

#### Scenario: Anything but the exact switch value leaves it off

- **WHEN** the switch holds a value such as "1" or "true"
- **THEN** the service is asked and a password is required, as without test mode

#### Scenario: The page says so

- **WHEN** test mode is on and a service is connected
- **THEN** the sign-in form shows a test-mode notice, asks for an employee code, and has no password field

### Requirement: An account's permanent reference is never an address or a code

Every person's account SHALL be identified for good by a reference
Featherbase assigns, which never changes and is not the person's email
address, username or employee code, however the account came to exist. Those
can change or be reused; the reference cannot.

#### Scenario: A person created by a Google sign-in changes their address

- **WHEN** someone's account was created by their first Google sign-in and
  they later move to a new Google address
- **THEN** their account, its history and everything that refers to it are
  unchanged; only their contact address is updated

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

A System Manager SHALL be able to see everyone who signed in but holds no role yet, newest first, with how they signed in and when, and open any of them to give them roles. Only an address's domain SHALL show in the list, even where a name is itself an address. A person created without a name SHALL start with the part of their address before the @. The menu SHALL show how many are waiting.

#### Scenario: A new starter shows up

- **WHEN** someone from an allowed company domain signs in with Google for the first time
- **THEN** a System Manager sees them on the waiting list with their domain, the sign-in method and the time, and the menu count goes up by one

#### Scenario: Giving a role takes them off the list

- **WHEN** a System Manager opens a waiting person and gives them a role
- **THEN** that person no longer shows as waiting

#### Scenario: Only System Managers see the list

- **WHEN** someone who is not a System Manager tries to open the waiting list
- **THEN** they are refused and see no count in their menu

### Requirement: Tell System Managers about a new arrival

When a sign-in rule creates a new person, every enabled System Manager with an email address SHALL get one email saying who arrived, from which domain, how they signed in, and where to give them access. A failed email SHALL NOT stop that person signing in. A day's alerts, counted by the India day, SHALL be capped; the cap is best-effort, so arrivals at the same moment can pass it by a few. Someone who arrives after the cap is reached SHALL NOT be emailed about later, but SHALL still show on the waiting list. Test-mode sign-ins SHALL NOT send alerts.

#### Scenario: One email per arrival

- **WHEN** a new person is created by their first Google sign-in and later signs in again
- **THEN** each System Manager got exactly one email about them

#### Scenario: An invited person is not announced

- **WHEN** a person an administrator invited signs in for the first time
- **THEN** no alert is sent, because someone already knows they are coming

#### Scenario: A busy day stops the emails, not the list

- **WHEN** more people arrive in one day than the daily cap allows
- **THEN** the later arrivals are not emailed about, then or later, and still show on the waiting list

#### Scenario: Mail trouble does not lock anyone out

- **WHEN** the email cannot be sent as a new person signs in
- **THEN** they are signed in as normal

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
