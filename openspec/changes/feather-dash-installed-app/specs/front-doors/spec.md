## ADDED Requirements

### Requirement: Each address opens one thing

An administrator SHALL be able to say, for each web address of an instance, what it
opens: the Admin screens or one installed app. A signed-in person who opens an app's
address SHALL go straight into that app, under the app's own name, without the Admin
menus.

#### Scenario: A manager opens the report address

- **WHEN** a Team Leader opens the Feather Dash address and signs in
- **THEN** they land in Feather Dash, which carries the Feather Dash name
- **AND** no Admin menu is shown

#### Scenario: Admin pages are not reachable through an app's address

- **WHEN** someone types an Admin page's path onto the Feather Dash address
- **THEN** they are taken back to Feather Dash instead

### Requirement: Emails use one chosen address

Every link Featherbase sends by email SHALL use the one address the administrator
marked for emails.

#### Scenario: An invitation opens the staff address

- **WHEN** the Feather Dash address is marked for emails and a manager is invited
- **THEN** the link in their invitation opens the Feather Dash address

### Requirement: People are handed to the address that has something for them

After signing in, a person SHALL stay on the address they used if it has something
for them. Otherwise they SHALL be taken, already signed in, to an address that does.
A person with nothing on any address SHALL be told who to ask.

#### Scenario: An administrator follows an emailed link

- **WHEN** a System Manager who cannot open Feather Dash follows an emailed link to
  the Feather Dash address and signs in
- **THEN** they arrive in the Admin screens on the Featherbase address without signing
  in again

#### Scenario: A manager signs in on the Admin address

- **WHEN** a manager who has nothing in the Admin screens signs in on the Featherbase
  address
- **THEN** they arrive in Feather Dash on its own address without signing in again

### Requirement: Sign in on the address you are on

Sign-in SHALL work on every address, with the page carrying the name of what that
address opens. Signing in with Google SHALL bring the person back to the address where
they started.

#### Scenario: Google sign-in returns to the app address

- **WHEN** a manager starts Google sign-in on the Feather Dash address
- **THEN** they come back signed in on the Feather Dash address

### Requirement: Each address keeps its own sign-in

Signing in on one address SHALL NOT sign the person in on another. Signing out on one
address SHALL end only the sign-in on that address.

#### Scenario: Signing out of the app leaves the Admin screens alone

- **WHEN** a System Manager signed in on both addresses signs out of Feather Dash
- **THEN** their Admin tab stays signed in

### Requirement: One top bar everywhere

Every address SHALL show the same top bar, with the person's account menu in the same
place, holding their sign-in methods and sign-out. On an app's address the bar SHALL
carry the app's name, and a way to open the Admin screens only for people who can use
them.

#### Scenario: A manager manages their sign-in methods from Feather Dash

- **WHEN** a manager in Feather Dash opens their account menu
- **THEN** they can reach their sign-in methods and sign out, as they would in the
  Admin screens

### Requirement: The address changes the look, not the access

An address SHALL NOT grant or remove anything. What a person may see or do SHALL be
decided the same way on every address.

#### Scenario: An administrator who reads the report opens the app address

- **WHEN** a System Manager who can open Feather Dash but holds no section opens it
- **THEN** Feather Dash tells them they have no sections, rather than showing every
  store's figures
