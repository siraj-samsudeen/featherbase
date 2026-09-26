## ADDED Requirements

### Requirement: Connect a database by typing its details

A builder SHALL be able to connect a Postgres or MySQL database by typing its
host, database name, user and password directly, without first setting
anything up on the server. Typing a full connection address SHALL fill in
the same fields, and the fields SHALL always show a password as hidden
characters, never in the open.

#### Scenario: Paste a connection address

- **WHEN** a builder pastes a full MySQL connection address into the console
- **THEN** the host, database, user and password fields fill in from it, and
  the password shows as hidden characters

### Requirement: A step-by-step check with a plain reason for the failing step

Testing a connection SHALL check it in order — reaching the host, agreeing
on encryption, signing in, and reading the database — and stop at the first
step that fails, naming that step and giving a plain-English reason (for
example, a firewall block, or a wrong password) instead of a raw technical
error. A step after the failing one SHALL stay unresolved, never marked as
succeeded or failed.

#### Scenario: Wrong password

- **WHEN** a builder tests a connection with the right host but the wrong
  password
- **THEN** reaching the host and agreeing on encryption both succeed, signing
  in fails with a reason pointing at the password or user, and reading the
  database is left unresolved

### Requirement: A saved connection keeps its health visible

Once a connection is saved, a builder SHALL be able to see whether it's
currently healthy, when it last succeeded, and — if it's failing — which
step is failing and how many connected tables are affected, and retest or
update its password from the same place at any time.

#### Scenario: A working connection breaks later

- **WHEN** a saved connection's password is changed at the other end and it
  stops working
- **THEN** the connection shows as failing, since when, and which step fails,
  and a builder can update the password and retest without recreating the
  connection

### Requirement: A successful test also reports what the account can do

A fully successful test SHALL also report whether the database account behind
it can only read, or can also write; if it can write while the connection is
marked read-only in Featherbase, the builder SHALL be told plainly that
Featherbase's read-only setting doesn't change what the account itself is
allowed to do at the source.

#### Scenario: A read-only connection whose account can actually write

- **WHEN** a builder tests a connection marked read-only, using a database
  account that can also write
- **THEN** the test succeeds and also warns that the account can write, and
  that Featherbase's read-only setting is not what's stopping it
