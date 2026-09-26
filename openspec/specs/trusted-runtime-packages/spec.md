# Trusted Runtime Packages

## Purpose

An app such as Tasker is built and delivered on its own, separately from
Featherbase itself. Installing it, opening it, upgrading it, and turning it
off keeps its data safe, keeps it out of every other app's way, and never
requires rebuilding Featherbase. Featherbase only installs apps that have
been reviewed and trusted beforehand — it does not sandbox untrusted code.

## Requirements

### Requirement: Install and open an app

Installing an app SHALL make it available to install once, and only to the
people the admin allows. An app that isn't installed, or that nobody has
access to, SHALL NOT appear in anyone's app catalog.

#### Scenario: Only the accessible apps show up

- **WHEN** an admin installs Tasker and gives a colleague access to it
- **THEN** the colleague sees Tasker in their app catalog and can open it
- **AND** someone without access does not see it there

### Requirement: Disabling keeps the data safe

Disabling an app SHALL immediately stop anyone from opening it or writing to
it, including a browser tab that was already open, while leaving every row
it holds untouched.

#### Scenario: A stale tab can't sneak a write through

- **WHEN** an admin disables Tasker while a colleague still has it open, and
  that colleague tries to save a change
- **THEN** the save is refused
- **AND** every row Tasker held before is still there afterward

### Requirement: Re-enabling needs the app's code in place

Turning a disabled app back on SHALL require its code to still be present.
If it's missing, the app SHALL stay unavailable — never active without it —
and its data SHALL stay intact and untouched until it's restored.

#### Scenario: Code goes missing and comes back

- **WHEN** Tasker's code is unavailable during a restart and is restored on
  the next one
- **THEN** Tasker stays unavailable in between
- **AND** once restored, its work is exactly as it was, with nothing run twice

### Requirement: Removing an app isn't offered yet

Featherbase SHALL only let an admin disable or re-enable an app that has its
own separately delivered code — never remove it or delete its data. Only an
older, simpler kind of add-on (plain data with no separate code) can be
removed this way, and it SHALL refuse to remove one of these more capable
apps.

#### Scenario: Removal is refused

- **WHEN** an admin tries to remove an installed app that has its own code
- **THEN** Featherbase refuses and says to disable it instead

### Requirement: Preview an upgrade before applying it

Before upgrading an app to a new version, an admin SHALL be able to see what
that upgrade will do — the version it moves to and what it changes — without
changing anything yet. Upgrading SHALL only proceed against that exact
reviewed preview; if anything about the app changed underneath since the
preview was taken, the upgrade SHALL be refused and ask for a fresh preview.

#### Scenario: A changed target asks for a new preview

- **WHEN** an admin previews an upgrade and the app's delivered code changes
  before they apply it
- **THEN** applying the old preview is refused
- **AND** the admin is asked to preview again

### Requirement: An upgrade only adds, and needs turning on afterward

Upgrading an app SHALL keep every existing row and its id exactly as it was,
and SHALL only add new, optional information — it SHALL refuse an upgrade
that would remove or change anything already there. Once an upgrade is
applied, the app SHALL stay on its previous version, unusable by anyone,
until the admin explicitly turns the new version on.

#### Scenario: Existing rows survive, extra fields start empty

- **WHEN** Tasker is upgraded to a version that adds an optional project
  description
- **THEN** every existing project keeps its data
- **AND** the new description starts empty until someone fills it in

#### Scenario: Turning it on is a separate, explicit step

- **WHEN** an admin applies a reviewed upgrade
- **THEN** the previous version keeps running until the admin separately
  activates the new one

### Requirement: A failed upgrade leaves the app exactly as it was

If an upgrade fails partway through, SHALL leave the app on its previous
version, fully working, with nothing partially changed.

#### Scenario: A broken migration changes nothing

- **WHEN** one step of an upgrade fails after an earlier step already ran
- **THEN** neither step's change is kept
- **AND** the app keeps running on its old version as if the upgrade had
  never been attempted

### Requirement: Task work from before Tasker existed carries into it

An account that already had tasks and projects before Tasker existed as an
installed app SHALL, on upgrading to a Featherbase release that includes
Tasker, keep every one of them exactly as it was — id, references, comments,
files, shares and who's responsible for each — now living inside Tasker
instead of the built-in place they used to be. If Tasker's own storage
already has something in the way, that upgrade SHALL refuse rather than
merge or overwrite either side.

#### Scenario: Nothing is lost in the handover

- **WHEN** an account with existing tasks and projects upgrades to a release
  that includes Tasker
- **THEN** every task and project keeps its id, its comments and files, and
  who it's shared with, now inside Tasker

#### Scenario: A collision is refused, not merged

- **WHEN** Tasker's own storage already holds something where that existing
  work would land
- **THEN** the upgrade refuses
- **AND** neither side's data is changed

### Requirement: An app's tables belong only to it

Two apps SHALL be able to use the very same name for one of their own tables
without ever colliding, even if a row in each happens to share the same id.
Each table an app declares SHALL belong to that app alone.

#### Scenario: Same name, same id, no mix-up

- **WHEN** two different installed apps each keep a table they both happen
  to call "Task," and a row with the same id exists in both
- **THEN** opening one never shows the other's data

### Requirement: App data is reachable only through the app

Data an installed app owns SHALL be reachable only by going through that
app itself — never through a raw data query or a generic report — whether
the app is on, off, or unavailable.

#### Scenario: A raw query can't read around the app

- **WHEN** someone tries to read an installed app's data through a generic
  report instead of the app's own screens
- **THEN** it's refused, regardless of whether the app is enabled

### Requirement: An app owns its own screen

An app that brings its own screen SHALL fully control what appears under
its own address; Featherbase SHALL NOT show one app's screen, or its own,
in place of a missing piece of another. A visitor who isn't signed in yet
SHALL land back on the exact app they opened once they sign in.

#### Scenario: A missing piece stays missing

- **WHEN** something inside Tasker's screen fails to load
- **THEN** it shows as missing
- **AND** neither Tasker's own home screen nor Featherbase's is shown instead

#### Scenario: Signing in returns to the app that was opened

- **WHEN** a signed-out person opens Tasker directly
- **THEN** after signing in they land back in Tasker, not on Featherbase's
  own home page

### Requirement: Featherbase and every app keep one working address

An older link to a Featherbase screen SHALL still work, redirecting to its
current address and keeping the rest of what was being looked at intact.

#### Scenario: An old link still gets you there

- **WHEN** someone opens a Featherbase admin link saved from before its
  addresses changed
- **THEN** it lands on the same screen at the current address, showing the
  same thing that link pointed to

### Requirement: platform_storage_is_explicit

Featherbase SHALL keep its own data in a clearly separate place from every
installed app's data, and from every other app's. Upgrading Featherbase
itself SHALL NOT move, rewrite, or lose an app's stored rows, permissions,
or history. A database created before this separation existed SHALL be
brought up to it automatically, in one uninterrupted step, before Featherbase
starts using it — nothing already there is lost or duplicated, including if
that step has to be retried after a failure.

#### Scenario: fresh_and_upgrade_converge_to_same_shape

- **WHEN** a brand-new database and a database created before this
  separation existed both run the same current upgrade
- **THEN** both end up with Featherbase's own data and every installed app's
  data in the same clearly separated shape
- **AND** existing rows, grants and history are preserved either way

#### Scenario: failed_convergence_retries_atomically

- **WHEN** that one-time move is forced to fail partway through and is then
  retried
- **THEN** the failed attempt leaves nothing partially moved
- **AND** the retry finishes cleanly, without duplicating anything

#### Scenario: production_era_prerequisites_precede_convergence

- **WHEN** a database from an older, still-supported release runs the
  current upgrade
- **THEN** every upgrade step it still needs runs first, in order, before
  the separation itself completes
- **AND** existing rows, grants and history are preserved throughout

#### Scenario: failed_legacy_prerequisite_retries_atomically

- **WHEN** one of those still-pending older upgrade steps fails partway
  through
- **THEN** neither its change nor its record of having run survives
- **AND** retrying applies it exactly once, keeping every earlier step that
  had already finished

#### Scenario: unsupported_legacy_ledger_rejected

- **WHEN** a database is too old — missing upgrade steps from further back
  than Featherbase still supports catching up on
- **THEN** the upgrade refuses and says which earlier steps are missing,
  without touching anything

### Requirement: A new access rule needs a new, reviewed version

An app SHALL only gain a new access rule — such as who may read or act on
one of its tables — by shipping a new, reviewed version; Featherbase SHALL
NOT let an already-installed version quietly pick up a rule it didn't
originally declare.

#### Scenario: An old version can't gain a new rule for free

- **WHEN** an app adds an access rule that its currently installed version
  never declared
- **THEN** using it requires installing that reviewed new version, previewed
  and turned on like any other upgrade

### Requirement: A row with retained activity or an outdated view resists deletion

An installed app's row SHALL NOT be deleted while it still has a comment or
a recorded edit — an attached file or an active share already block deletion
under the Files and Sharing capability, and that rule extends to these too.
Deleting SHALL also be refused if the row has changed since whoever is
deleting it last looked at it.

#### Scenario: A commented row resists deletion

- **WHEN** someone tries to delete a task that has a comment on it
- **THEN** the deletion is refused
- **AND** the task and its comment are both still there afterward

#### Scenario: An outdated view can't delete a row that has since changed

- **WHEN** someone tries to delete a row using a copy of it they loaded
  before someone else changed it
- **THEN** the deletion is refused

## Deferred

Marketplace discovery, code signing, isolating untrusted code, running more
than one server at once, removing an app or deleting its data outright, and
letting an app remember its own settings are not built yet.
