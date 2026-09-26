## ADDED Requirements

### Requirement: Connect a database by typing its details

A builder SHALL be able to connect a Postgres or MySQL database by typing its
host, database name, user and password directly, without first setting
anything up on the server. Typing a full connection address SHALL fill in
the same fields, and the fields SHALL always show a password as hidden
characters, never in the open. On a deployment where anyone can sign in, the
page SHALL say that a saved data source is readable by every System Manager.

#### Scenario: Paste a connection address

- **WHEN** a builder pastes a full MySQL connection address into the console
- **THEN** the host, database, user and password fields fill in from it, and
  the password shows as hidden characters

### Requirement: A step-by-step check with a plain reason for the failing step

Testing a data source SHALL check it in order — reaching the host, agreeing
on encryption, signing in, and reading the database — and stop at the first
step that fails, naming that step and giving a plain-English reason (for
example, a firewall block, or a wrong password) instead of a raw technical
error. A step after the failing one SHALL stay unresolved, never marked as
succeeded or failed.

#### Scenario: Wrong password

- **WHEN** a builder tests a data source with the right host but the wrong
  password
- **THEN** reaching the host and agreeing on encryption both succeed, signing
  in fails with a reason pointing at the password or user, and reading the
  database is left unresolved

### Requirement: A saved data source keeps its health visible

Once a data source is saved, a builder SHALL be able to see whether it's
currently healthy, when it last succeeded, and — if it's failing — which
step is failing and how many connected tables are affected, and retest or
update its password from the same place at any time.

#### Scenario: A working data source breaks later

- **WHEN** a saved data source's password is changed at the other end and it
  stops working
- **THEN** it shows as failing, since when, and which step fails, and a
  builder can update the password and retest without recreating it

### Requirement: A successful test also reports what the account can do

A fully successful test SHALL also report whether the database account behind
it can only read, or can also write; if it can write while the data source is
marked read-only in Featherbase, the builder SHALL be told plainly that
Featherbase's read-only setting doesn't change what the account itself is
allowed to do at the data source.

#### Scenario: A read-only data source whose account can actually write

- **WHEN** a builder tests a data source marked read-only, using a database
  account that can also write
- **THEN** the test succeeds and also warns that the account can write, and
  that Featherbase's read-only setting is not what's stopping it
