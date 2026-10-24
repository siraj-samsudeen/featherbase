## ADDED Requirements

### Requirement: An address can open one app directly

An administrator SHALL be able to point a web address at one installed app. A
signed-in person who opens that address, called the app's front door, SHALL go
straight into that app under the app's own name, without the admin Desk's menus.

#### Scenario: A manager opens the report address

- **WHEN** a Team Leader opens the Feather Dash address and signs in
- **THEN** they land in Feather Dash, which carries the Feather Dash name
- **AND** no admin menu or app switcher is shown

#### Scenario: The Desk is not reachable through the app address

- **WHEN** someone types an admin page's path onto the Feather Dash address
- **THEN** they are taken back to Feather Dash instead

### Requirement: The admin address stays the Desk

An address that is not a front door SHALL keep working exactly as before. A person
who uses the Desk keeps the Desk there.

#### Scenario: An administrator keeps the Desk

- **WHEN** a System Manager signs in on the Featherbase address
- **THEN** they land in the Desk as before

### Requirement: Sign in on the address you are on

Sign-in SHALL work on every address, with the page carrying that address's name.
Signing in with Google SHALL bring the person back to the address where they started.

#### Scenario: Google sign-in returns to the app address

- **WHEN** a manager starts Google sign-in on the Feather Dash address
- **THEN** they come back signed in on the Feather Dash address, not on the Desk's

### Requirement: Each address keeps its own sign-in

Signing in on one address SHALL NOT sign the person in on another address. Signing
out on one address SHALL end only the sign-in on that address.

#### Scenario: Signing out of the app leaves the Desk alone

- **WHEN** a System Manager signed in on both addresses signs out of Feather Dash
- **THEN** their Desk tab stays signed in

### Requirement: People without Desk access are taken to their app

A person who has nothing to use in the Desk but can open an app with a front door,
and who signs in on the Desk's address, SHALL be taken to that front door already
signed in.

#### Scenario: A manager follows an invitation email

- **WHEN** a manager follows the link in their invitation email, which opens the
  Desk's address, and signs in
- **THEN** they arrive in Feather Dash on its own address without signing in again

### Requirement: The address changes the look, not the access

A front door SHALL NOT grant or remove anything. What a person may see or do SHALL be
decided the same way on every address. Someone who can also use the Desk SHALL get a
way to reach it from the app.

#### Scenario: An administrator opens the app address

- **WHEN** a System Manager who holds no section opens Feather Dash
- **THEN** Feather Dash tells them they have no sections, rather than showing every
  store's figures
- **AND** they have a way to open the Desk
