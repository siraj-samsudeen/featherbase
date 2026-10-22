# Sign In and Accounts Delta

## ADDED Requirements

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
receive mail, one ending in ".invalid", is not kept.

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

A linked sign-in method SHALL be recognised only by the permanent ID its
provider keeps for the person, such as a Google account's ID or an HR system
employee code. A changed email or name at the provider does not change whose
account opens, and two matching email addresses never link a sign-in to an
account.

#### Scenario: Google address changes

- **WHEN** a person whose Google account is linked changes that account's
  address and signs in with Google again
- **THEN** they open their own account as before

#### Scenario: Someone else's address

- **WHEN** a Google account that is not linked to anyone signs in, and its
  address equals the email on an existing account
- **THEN** it does not open that existing account; it is treated as a person
  Featherbase does not know

### Requirement: Rule for people a method does not know

Each sign-in method SHALL follow the rule an administrator chose for a person
it does not recognise: make an account for them, make one only when the
method vouches for an email address on an allowed domain, or refuse. A method
that cannot vouch for a permanent ID, such as the HR system, can only refuse.
A new account starts with no access beyond what every signed-in person has.

#### Scenario: Google with allowed domains

- **WHEN** Google's rule is to admit only allowed domains and someone unknown
  signs in with a Google account belonging to an allowed company domain
- **THEN** an account is made for them, linked to their Google account, and
  they are signed in

#### Scenario: HR system only signs in people already set up

- **WHEN** someone types an HR system ID that is not linked to any account
- **THEN** they are refused like a wrong password, and their password is not
  sent to the HR system

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

An administrator SHALL be able to link a sign-in method to any person, change
or move a link in one step, and remove one. A Google account can be invited
by its address before the person first signs in: their first Google sign-in
with that address links the account for good, and after that the address is
never used to find them. An invite is cancelled when the person's email
changes or is cleared, and is never claimed for a disabled account.

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
account by proving it, for example by completing a Google sign-in. They must
have signed in within the last few minutes, and a method already linked to
someone else is refused.

#### Scenario: Add Google to an HR system account

- **WHEN** a Team Leader who just signed in with their HR system ID chooses to
  link a Google account and completes Google's sign-in
- **THEN** that Google account is linked and later opens the same account

#### Scenario: Already someone else's

- **WHEN** a person tries to link a Google account that is already linked to a
  different account
- **THEN** the link is refused and neither account changes

### Requirement: Some sign-ins cannot change access

A session that cannot vouch for the person SHALL NOT add or remove access to
the account: it cannot link or remove a sign-in method, set a password, or
create an access token. That covers a test-mode sign-in, a preview link's
click-through sign-in, and a session that was opened before this change. Such
a session can still read until it expires.

#### Scenario: Tester tries to keep a way in

- **WHEN** a tester who signed in as a Team Leader through test mode tries to
  set a password on that account or link their own Google account to it
- **THEN** both are refused and the account is unchanged

#### Scenario: Signed in before the upgrade

- **WHEN** a person still signed in from before the upgrade tries to remove one
  of their sign-in methods
- **THEN** they are asked to sign in again first, and can keep reading meanwhile

### Requirement: Removing a sign-in method

A person SHALL be able to remove a sign-in method from their account, except
their last working one; a pending invite does not count as a way in.
Removing a method, or an administrator turning a method off, ends the sessions
opened with it. Sessions opened before this change do not record how they were
opened, so they are not ended this way; they keep reading until they expire
and cannot change access.

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

### Requirement: Someone who has left is refused everywhere

When a connected service reports that a person has left, Featherbase SHALL
disable their account, end all their sessions and refuse the sign-in, keeping
the account's history. Every other way in then refuses them too.

#### Scenario: Leaver who also has a password

- **WHEN** someone who has left signs in with their still-working HR system
  password, and later tries their Featherbase password
- **THEN** both are refused, and the account is disabled with its history kept

### Requirement: Existing sign-ins carry over

Everyone who could sign in before this change SHALL keep signing in the same
way without doing anything. A person who had already signed in with Google
gets a one-time link: their next Google sign-in with the same address links
their Google account's permanent ID, and from then on the address is never
used to find them. Other people with an email address are listed before the
upgrade, together with a check that everyone who can sign in today keeps a
way in, so an administrator can invite them straight after it.

#### Scenario: Store staff the morning after

- **WHEN** a Team Leader signs in with their HR system ID, typed in any mix
  of capitals, the day after the upgrade
- **THEN** they open the same account and report as the day before

#### Scenario: First Google sign-in after the upgrade

- **WHEN** a person who used to sign in with Google signs in with it for the
  first time after the upgrade
- **THEN** they open their own account, and their Google account is linked to
  it by its permanent ID

### Requirement: No fallback during an outage

When a connected sign-in service is not answering, Featherbase SHALL NOT try
another way to sign the person in with what they typed, such as a password it
holds itself.

#### Scenario: HR system down

- **WHEN** the HR system is down and a person who also has a Featherbase
  password signs in with their HR system ID
- **THEN** they are told the HR system is unavailable and are not signed in

## MODIFIED Requirements

### Requirement: Sign in with a password

Signing in SHALL check a username or email, ignoring capital letters, against
a password. When what was typed is one person's username and another
person's email, the username wins. A failed attempt SHALL be refused with the
same generic message whether the account doesn't exist, the password is
wrong, or the account can't sign in this way, so it never reveals which.

#### Scenario: Wrong password

- **WHEN** a user signs in with an account that exists but the wrong password
- **THEN** they are refused with a generic invalid-credentials message

#### Scenario: Username beats email

- **WHEN** one account's username is "meena" and another account's email is
  "meena", and someone signs in as "meena"
- **THEN** only the first account's password is checked

### Requirement: Sign in with Google

Featherbase SHALL let a user sign in with their Google account. A Google
account that is linked to a person opens that person's account; any other
Google account is handled by the rule an administrator chose for people
Google does not recognise.

#### Scenario: First-time sign-in from an allowed domain

- **WHEN** someone with no Featherbase account signs in with a Google account
  belonging to an allowed company domain
- **THEN** an account is created for them and they are signed in

#### Scenario: Domain not allowed

- **WHEN** someone with no Featherbase account signs in with Google using an
  address from a domain that isn't allowed
- **THEN** they are refused and told to contact IT

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

### Requirement: Who may sign in

Only a human account an administrator has enabled SHALL be able to sign in
interactively, by any of its linked sign-in methods. A disabled account, and
an automation account created for scripts, SHALL be refused every way. An
automation account needs no email and has no sign-in method.

#### Scenario: A disabled account can't sign in

- **WHEN** a disabled account's owner tries to sign in, by password, by
  Google or through a connected service
- **THEN** they are refused

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

### Requirement: Test mode for sign-in through a connected service

A deployment MAY switch on test mode for sign-in through a connected service,
only through its server environment and only with an exact switch value. While
it is on, the service SHALL NOT be asked: a tester signs in as a person by
typing the employee code their account is linked to at that service, in any
mix of capitals, with no password. Who may sign in is otherwise unchanged —
one enabled account linked to the service, and not the Administrator or a
System Manager. The sign-in page SHALL say that test mode is on and ask for an
employee code.

Because the service is not asked, it cannot report that someone has left.
While test mode is on, a person who has left is refused only when their
account is disabled; the instance that runs test mode SHALL keep leavers'
accounts disabled. Test mode is for a trial instance and SHALL NOT be switched
on where real users sign in.

#### Scenario: Open the report as a Team Leader during a trial

- **WHEN** test mode is on and the tester types a Team Leader's employee code with no password
- **THEN** they are signed in as that Team Leader and the service is not contacted

#### Scenario: Test mode does not widen who can sign in

- **WHEN** test mode is on and the employee code is linked to no account, or to a disabled account or a System Manager
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
