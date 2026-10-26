# Running an Instance

## Purpose

The person who runs a Featherbase instance gets a safe way to put new versions
live, a way to check an instance is healthy, protection against pointing the
wrong database or the wrong switches at the wrong instance, a small set of
commands for jobs done on the server itself, and a predictable way for the
server to say no. An "environment" is the kind of instance something is:
production, staging (a hosted trial), development or test. A "release" is
the step an operator runs when new code goes live.

## Requirements

### Requirement: A release brings the database up to date

A release SHALL apply every database change that has not been applied yet,
then every pending one-off fix, and SHALL leave an instance that is already up
to date as it was.

#### Scenario: Releasing an older instance keeps its data

- **WHEN** an operator releases a new version onto an instance last released
  some versions ago
- **THEN** its rows and permissions are all still there afterwards
- **AND** the instance is on the new version

#### Scenario: Releasing twice

- **WHEN** an operator releases again with nothing new to apply
- **THEN** nothing is applied a second time

### Requirement: Each one-off fix runs once

A one-off fix, called a patch, SHALL run exactly once per database, in order. If one fails,
the patches before it SHALL stay applied and the failed one SHALL leave no
trace, so it is tried again at the next release.

#### Scenario: A patch is never repeated

- **WHEN** the operator runs the patches several times
- **THEN** each patch has run once, in its listed order

#### Scenario: A patch fails

- **WHEN** a patch fails part-way
- **THEN** the run stops there, the patches before it stay applied, and neither
  the failed patch's changes nor any later patch is applied

### Requirement: A failed database change changes nothing

When a database change fails during a release, the instance SHALL be left as
it was before that change, and the next release SHALL carry on from the same
point.

#### Scenario: A change fails halfway

- **WHEN** a database change fails while the release is recording it
- **THEN** nothing it did remains
- **AND** the next release applies it once

### Requirement: The person-record changes stand or fall together

The database changes that move people onto their permanent records SHALL be
applied as one step, so a failure in any of them leaves none of them applied.

#### Scenario: One of the person changes fails

- **WHEN** a release applies the person-record changes and one of them fails
- **THEN** none of them is left applied

### Requirement: A release refuses an instance that skipped versions

A release SHALL refuse an instance whose earlier database changes are not all
recorded, and SHALL say which are missing, before changing anything.

#### Scenario: An instance with a gap in its history

- **WHEN** an operator releases onto an instance that is missing one of its
  earlier database changes
- **THEN** the release stops, names the missing change, and changes nothing

### Requirement: Two releases at once do not collide

When two releases of the same instance start together, the second SHALL wait for the
first to finish, then find nothing left to do.

#### Scenario: A second release starts during the first

- **WHEN** a release starts while another release of the same database is
  still running
- **THEN** it waits, and applies nothing until the first has finished

### Requirement: A release checks what it can before changing anything

Before the first database change, a release SHALL check everything that does
not need the data and SHALL stop, naming the problem, if the instance must not
be released. Every check that passed is listed.

#### Scenario: The release does not say what it is

- **WHEN** an operator runs a release without saying which environment it is
- **THEN** the release stops and asks for the environment to be declared,
  rather than treating the instance as development

#### Scenario: A refusal comes before any change

- **WHEN** a production release finds a switch on that production must never
  have
- **THEN** the release stops and no database change has been applied

### Requirement: A release warns that system alerts would reach nobody

A release SHALL warn, and go ahead, when no System Manager other than the
built-in Administrator has an email address.

#### Scenario: Nobody to receive alerts

- **WHEN** a release finds no such System Manager
- **THEN** it prints a warning that system alerts will reach nobody
- **AND** the release still completes

### Requirement: A release stops a data feed that would break updates

On a Postgres version where this matters, a release SHALL refuse while a
data-replication feed would make every update to people's roles fail, and
SHALL say how to fix the feed.

#### Scenario: A feed that does not carry the new columns

- **WHEN** a release is about to give role records calculated columns while a
  replication feed copies them without those columns
- **THEN** the release stops before migrating and names the fix for that feed

### Requirement: A database remembers its environment

Each database SHALL record the environment it belongs to, and a server or
release of a different environment SHALL refuse to run against it, naming
both environments and the database but never its password. A brand-new
database is claimed by the first environment that migrates it.

#### Scenario: A test run pointed at production

- **WHEN** a process running as one environment is pointed at a database
  recorded as another
- **THEN** it refuses and names both environments

#### Scenario: A deliberate override

- **WHEN** the operator sets the break-glass override for this one run
- **THEN** the run goes ahead against the other environment's database

### Requirement: Sign-in shortcuts stay off outside development and trials

The server and the release SHALL refuse to start while a switch that signs
people in without proof is turned on in production: the test-mode password
shortcut, the mock Google sign-in and the one-link preview sign-in. The
test-mode shortcut and the preview link MAY run on a hosted trial (staging);
the mock Google sign-in runs only in development and test. A database recorded
as production never runs with test mode.

#### Scenario: Test mode on production

- **WHEN** an operator starts a production server with test mode switched on
- **THEN** it refuses to start and names the switch

#### Scenario: A trial instance

- **WHEN** an operator starts a staging server with test mode switched on
- **THEN** it starts

#### Scenario: Test mode against a production database

- **WHEN** a staging release has test mode on, but its database is recorded
  as production
- **THEN** the release refuses and names the database's label

### Requirement: A new production instance has no known password

A newly created production instance SHALL NOT have a password for the built-in
Administrator unless the operator supplied one, and an existing password SHALL
never be changed by a release or by seeding. A development or test instance
starts with an easy password so a checkout works at once.

#### Scenario: A fresh production instance

- **WHEN** an operator creates a production instance without choosing a password
- **THEN** the Administrator cannot sign in with a password
- **AND** the release warns that the first administrator still has to be set up

#### Scenario: A password already set

- **WHEN** a release or seed runs while the Administrator already has a password
- **THEN** that password is unchanged, even if the operator supplied another

### Requirement: An instance's web addresses are checked

An instance that lists its web addresses SHALL refuse to start, and a release
SHALL refuse, when the list is not valid. Each address must be a plain web
origin with no path, secure outside development and test, listed once. Each must open the
Admin screens or an app. Exactly one is marked for emailed links, and at least
one opens Admin.

#### Scenario: A plain http address in production

- **WHEN** a production instance lists an address that is not secure
- **THEN** it refuses to start and names the address

#### Scenario: No address used for emails

- **WHEN** the list marks no address, or two, for emailed links
- **THEN** the list is refused and the rule is named

### Requirement: Operator commands run when the server will not start

An operator on the server SHALL still be able to run the command-line tools
(setting a text setting, creating a person, listing tokens) while the server
or a release refuses for a missing variable, so the instance can be repaired
from inside.

#### Scenario: A required secret is missing

- **WHEN** a production instance is missing a required secret
- **THEN** the server and the release refuse
- **AND** the operator can still create a person and change a text setting from
  the command line

### Requirement: Rehearse an environment's start-up checks

An operator SHALL be able to run the server's start-up checks and the release
checks with a target environment's real settings, without starting the server
or changing anything, and read what each says.

#### Scenario: A production configuration that would refuse

- **WHEN** the operator rehearses with a switch on that production forbids
- **THEN** the rehearsal fails and names the switch

#### Scenario: A configuration that would start

- **WHEN** the operator rehearses a good configuration
- **THEN** it says the server will start and lists what the release checks passed

### Requirement: Send a test email from the server

An operator SHALL be able to send one test email through the configured
mail setup and be told whether it went out, without the recipient or
credentials appearing in the output.

#### Scenario: Mail works

- **WHEN** the operator sends a test email through a working mail server
- **THEN** the message is delivered and the command says so

#### Scenario: The mail server refuses

- **WHEN** the mail server refuses the message
- **THEN** the command fails and shows the server's reply with every address and
  the password hidden

### Requirement: The command line lists what it can do

Running the command line with no command or an unknown one SHALL list the
available commands, and an unknown command SHALL count as a failure.

#### Scenario: A mistyped command

- **WHEN** the operator types a command that does not exist
- **THEN** the available commands are listed and the command fails

### Requirement: A running server can be checked

The server SHALL answer a public check, without signing in, to say it is up,
that its database answers, which environment it is, and whether its database
is on the same machine.

#### Scenario: A healthy server

- **WHEN** anyone asks a running server whether it is up
- **THEN** it says it is, that the database answers, and which environment it runs as

### Requirement: A person who sends too many requests is slowed down

Each signed-in person SHALL have a limit on how many requests they can make in a short
window. Past it they SHALL be told to wait, and for how long, and other people
SHALL be unaffected. An administrator can give one person a different limit.

#### Scenario: Over the limit

- **WHEN** a person with a limit of three requests makes a fourth in the same window
- **THEN** they are told they sent too many and how many seconds to wait

#### Scenario: Someone else is unaffected

- **WHEN** one person has used up their limit
- **THEN** another person's requests in the same window still succeed

### Requirement: Every failure answers in one shape

Every refusal or failure from the server SHALL name a kind of error and a plain message, in the same
shape, including for pages that do not exist. A failure the server did not
expect SHALL say only that something went wrong.

#### Scenario: Something that does not exist

- **WHEN** a signed-in client asks for a page or row that does not exist
- **THEN** it is told it was not found, in the usual shape

#### Scenario: A bad request

- **WHEN** a client sends text that is not valid data, or a number where a
  number is needed
- **THEN** it is told the request was malformed rather than that the server failed

#### Scenario: A value that is wrong

- **WHEN** a save is refused because a value is wrong
- **THEN** the answer names the field and what is wrong with it

#### Scenario: An unexpected fault

- **WHEN** the server meets a fault it did not expect
- **THEN** the client is told only that an internal error occurred, never the detail

### Requirement: Only the instance's own web pages may call it from another site

The server SHALL let pages from the instance's configured web origins call it from a
browser on another origin, and SHALL give any other origin no permission to.

#### Scenario: An allowed origin

- **WHEN** a page from a configured origin calls the server
- **THEN** the browser is allowed to read the answer

#### Scenario: Any other origin

- **WHEN** a page from another origin calls the server
- **THEN** the browser is not given permission

### Requirement: Browser protections on every response

Every answer SHALL carry the standard browser protections: no guessing of file
types, no showing the page inside another site's frame, and no sending the
page address to other sites.

#### Scenario: Any response

- **WHEN** anyone requests any page from the server
- **THEN** the answer carries those protections

### Requirement: Open pages hear about changes as they happen

A signed-in page SHALL be told when a row it watches is created, changed or
deleted, and when something happens that is just for that person, so it can
refresh without being reloaded.

#### Scenario: Someone else saves a row

- **WHEN** one user saves a row and another user's page is watching that table
- **THEN** the other page is told that row changed

#### Scenario: A private notice

- **WHEN** something happens that is for one person only
- **THEN** only that person's pages are told

### Requirement: A page only hears about what its person may see

A page SHALL only be able to watch tables its person can read, and its own
personal notices. It SHALL only be told about rows its person can see now,
checked at the moment of each change.

#### Scenario: A table the person cannot read

- **WHEN** a user asks to watch a table they have no read permission on
- **THEN** the request is refused and nothing from that table reaches them

#### Scenario: Access removed while watching

- **WHEN** a user loses read permission, or has a row narrowed out of their reach, while their page is watching
- **THEN** their next update from it is not delivered

#### Scenario: Another person's notices

- **WHEN** a user asks to watch another person's personal notices
- **THEN** the request is refused

### Requirement: Only a signed-in page can listen

Live updates SHALL be offered only to a page whose person is signed in. A
sign-in key placed in the connection's web address SHALL NOT count.

#### Scenario: Connecting without signing in

- **WHEN** a page connects with no valid sign-in
- **THEN** the connection is closed as unauthorised and nothing is sent
