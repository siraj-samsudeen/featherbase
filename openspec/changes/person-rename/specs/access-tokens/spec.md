# Access Tokens Delta

## MODIFIED Requirements

### Requirement: Service accounts for automation

A System Manager SHALL be able to create a service account: an automation
account with roles but no password, that never signs in and authenticates
only by token. It is its own kind of account, not a person: it keeps its
tokens, roles, data access and shared rows exactly as a person would, and a
token issued to it behaves like a token issued to a person. A System Manager
issues its tokens on its behalf.

#### Scenario: A service account can't sign in

- **WHEN** someone tries to sign in as a service account with a password
- **THEN** they are refused, the same as for any account with no working
  password

#### Scenario: A service account's data access applies everywhere

- **WHEN** a service account limited to one store's rows reads a list, opens
  a row, runs a report, searches, exports or listens for live updates
- **THEN** it sees only that store's rows on every one of those paths

#### Scenario: A service account keeps what it has

- **WHEN** the instance is upgraded so that automation accounts are kept apart
  from people
- **THEN** every service account still has its tokens, its roles and the data
  access and shared rows it had, and its scripts keep working without a new
  token
