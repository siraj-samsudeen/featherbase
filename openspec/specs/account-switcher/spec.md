# account-switcher Specification

## Purpose
One browser holds several accounts its user has really signed in with, and moves between them in one click without a password. Each account stays a real session that can act, ends exactly as any session does, and every switch is recorded (#1255).

## Requirements

### Requirement: A browser holds several signed-in accounts
A browser SHALL hold every account signed in on it, up to five, each as its own session with its own expiry. No password is kept. An account joins only through a real sign-in on that browser.

#### Scenario: Two accounts on one browser

- **WHEN** Siraj signs in with his StyleHR ID, chooses "Add another account" and signs in with his jeyarama.com Google account
- **THEN** the browser holds both accounts, and Siraj is signed in as the jeyarama.com account

#### Scenario: A sixth account

- **WHEN** a browser holds five live accounts and the person tries to add another
- **THEN** they are told five is the most a browser holds, and asked to remove one first

### Requirement: Switch accounts in one click
The person SHALL be able to continue as any live account held on the browser in one click, from the sign-in page or from the Account menu, without typing a password. The page then shows and acts as that account.

#### Scenario: Switch from the Account menu

- **WHEN** Siraj, signed in with his StyleHR ID, picks his jeyarama.com account under "Switch to"
- **THEN** the page reloads signed in as the jeyarama.com account, with no password asked

#### Scenario: Continue from the sign-in page

- **WHEN** a person opens the sign-in page on a browser holding their account
- **THEN** the account is listed, the last used marked "Last used", and clicking it signs them in without a password

#### Scenario: Other tabs follow

- **WHEN** a person switches account in one tab while another tab of the same browser is open
- **THEN** the other tab reloads as the new account

### Requirement: A held account ends as any session does
A held account SHALL stop working exactly when its session would: when it runs out, is signed out, when the person's sessions are ended, when the person is turned off, or when the sign-in method it used is ended. It then shows as signed out, with the reason, and Sign in opens the sign-in form with its ID filled in.

#### Scenario: The person is turned off

- **WHEN** an administrator turns off RB while RB's account is held on Rony's browser
- **THEN** choosing RB's account does not sign in, and RB's account shows as signed out

### Requirement: Sign out of one account, or all
Signing out SHALL end the current account's session and take it off the browser's list. If other live accounts are held, the page continues as the most recently used of them. Signing out of all accounts SHALL end every session the browser holds.

#### Scenario: Sign out of one

- **WHEN** Siraj, holding two accounts, signs out of the StyleHR one
- **THEN** that session ends, it leaves the list, and the page continues as his jeyarama.com account

#### Scenario: Sign out of all

- **WHEN** a person holding three accounts signs out of all accounts
- **THEN** all three sessions end and the plain sign-in page is shown

#### Scenario: Remove an account from the list

- **WHEN** a person removes an account from the sign-in page's list
- **THEN** its session ends and it is no longer listed

### Requirement: Switching is recorded
Every switch SHALL be recorded in the Access Log under the account switched to, naming the account switched from. An account joining a browser that already holds others SHALL be recorded as signed in on the same browser as each of them. Changes are recorded as the account that made them.

#### Scenario: Rony acts for RB

- **WHEN** Rony, signed in as herself, adds RB's account on her browser and switches to it
- **THEN** the Access Log shows RB's account joining the browser beside Rony's, and the switch from Rony to RB

### Requirement: View as and switching stay apart
A switch, a sign-out or a removal SHALL end any View as on the session it leaves. Nobody becomes a held account through View as.

#### Scenario: Switching while viewing

- **WHEN** a tester viewing as Meena switches to another of their accounts
- **THEN** the View as ends, and the other account starts with no one viewed
