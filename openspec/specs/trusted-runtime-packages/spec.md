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

#### Scenario: A turned-off app can't be opened

- **WHEN** an admin turns Tasker off and a colleague then opens its address
- **THEN** they are told it is unavailable and that its data is kept
- **AND** Tasker is no longer in their app catalog

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

### Requirement: An upgrade keeps what it does not remove, and needs turning on afterward

Upgrading an app SHALL keep every existing row and its id exactly as it was,
except what the new version explicitly declares it removes. Once an upgrade is
applied, the app SHALL be unavailable to everyone — not still running on its
previous version — until the admin explicitly activates the new one.

#### Scenario: Existing rows survive, extra fields start empty

- **WHEN** Tasker is upgraded to a version that adds an optional project
  description
- **THEN** every existing project keeps its data
- **AND** the new description starts empty until someone fills it in

#### Scenario: Turning it on is a separate, explicit step

- **WHEN** an admin applies a reviewed upgrade
- **THEN** the app is unavailable to everyone until the admin separately
  activates the new version

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

### Requirement: Dashboards reach an app's data only while it is on

While an installed app is on, a dashboard number card or chart SHALL be able to count its data, showing only what the person's own permissions let them read. While the app is off or unavailable, its data SHALL NOT be counted or charted at all, and it stays stored for when the app is turned back on.

#### Scenario: Count an app's data on a dashboard

- **WHEN** a member who can read an app's tasks adds a card counting them while the app is on
- **THEN** the card shows how many tasks there are, and a member who can't read those tasks is refused

#### Scenario: A turned-off app's data is kept out of dashboards

- **WHEN** an administrator turns the app off and someone opens that card or a chart of the same tasks
- **THEN** it's refused, and the tasks themselves are kept

### Requirement: An app owns its own screen

An app that brings its own screen SHALL fully control its address, document,
inner navigation and styling. Featherbase SHALL serve only that app's declared
client files, SHALL NOT show one app's screen or its own in place of a missing
piece, and SHALL preserve an app-owned deep path, query and fragment across
sign-in and refresh while loading the app's entry document.

Featherbase SHALL render every app screen inside its responsive host shell on
desktop and touch/mobile. The shell SHALL keep a persistent Featherbase Admin
icon immediately followed by one keyboard-operable app switcher. The switcher
SHALL identify the current destination and contain Featherbase Admin plus every
active installed app the current member is allowed to open. It SHALL refresh
after the document regains focus or visibility, omit unavailable destinations,
and return to Featherbase Admin if the current destination becomes unavailable.

The Home destination SHALL be the single responsive route to Featherbase's
ordinary host controls; neither the shell nor an app SHALL create a second app
list. Shell controls SHALL have accessible names, visible keyboard focus and
usable touch targets without obscuring or replacing app-owned content. An app
with its own screen SHALL NOT also create a competing generated Home Page; its
tables remain available to administrators.

#### Scenario: A missing piece stays missing

- **WHEN** something inside Tasker's screen fails to load
- **THEN** it shows as missing
- **AND** neither Tasker's own home screen nor Featherbase's is shown instead

#### Scenario: Signing in returns to the app that was opened

- **WHEN** a signed-out person opens a nested Tasker address with query state
  and a selected task in its fragment
- **THEN** after signing in and refreshing they remain at that exact address
  with the selected task open

#### Scenario: Every app opens in the host shell

- **WHEN** an authorized member opens an app on desktop or touch/mobile
- **THEN** the Home icon and unified app switcher remain available while the
  app's own navigation and content render unchanged below them

#### Scenario: The switcher follows current access

- **WHEN** app access is granted, removed, disabled, made unavailable or
  restored before the document regains focus or visibility
- **THEN** the refreshed switcher contains Featherbase Admin plus exactly the
  active installed apps that member can open
- **AND** if the current app disappeared, the member returns to Featherbase Admin

#### Scenario: Host controls work with keyboard and touch

- **WHEN** a member uses the shell on desktop or a touch/mobile viewport
- **THEN** Home and the switcher have accessible names, visible focus and
  usable targets, and app-owned controls remain operable

#### Scenario: Home restores Featherbase controls

- **WHEN** a member activates the Home icon or chooses Featherbase Admin
- **THEN** they reach Featherbase's responsive navigation, command, account,
  appearance, language, notification and permitted administration controls

#### Scenario: An app can be delivered without rebuilding core

- **WHEN** built Tasker is staged after Featherbase core was built
- **THEN** Tasker opens inside the host shell without a core rebuild or a
  Tasker-specific core route

### Requirement: Featherbase and every app keep one working address

An older link to a Featherbase screen SHALL still work, redirecting to its
current address and keeping the rest of what was being looked at intact.

#### Scenario: An old link still gets you there

- **WHEN** someone opens a Featherbase admin link saved from before its
  addresses changed
- **THEN** it lands on the same screen at the current address, showing the
  same thing that link pointed to

### Requirement: platform_storage_is_explicit
Featherbase-owned relations and functions SHALL live in PostgreSQL schema
`featherbase`. A fresh install SHALL create them there. An upgrade SHALL move
existing objects without replacing their identities, rows, constraints, indexes,
grants, RLS policies, references or migration history. Core logical identities
SHALL remain compatible and unqualified; application logical and physical
identities SHALL remain scoped. Runtime and migration paths SHALL resolve physical
relations deterministically without pooled mutable `search_path` routing.
Security-definer functions SHALL restrict name resolution and explicitly address
their dependencies.

`public.site` SHALL remain an explicitly named pre-tenant host registry. It SHALL
NOT be treated as tenant data or moved into the core schema. Site data SHALL remain
isolated in its selected site schema.

Legacy databases SHALL have all migrations through `0087_dataset_snapshot_tables.ts`
recorded before upgrading directly with the current release. Older or incomplete
legacy ledgers SHALL be rejected before migration mutation, naming the missing
migrations and requiring an intermediate historical upgrade. Supported legacy
upgrades SHALL apply pending prerequisites in order before convergence. Every
migration's effects and ledger entry SHALL commit together; retries SHALL skip
committed prerequisites and resume the first pending migration.

#### Scenario: fresh_and_upgrade_converge_to_same_shape
- **WHEN** a fresh database and an asymmetric exact pre-convergence database run
  the production migration command
- **THEN** both expose the same Featherbase-owned object shape, preserve expected
  upgrade rows and privileges, retain scoped app storage, and leave only the site
  registry at `public.site`.

#### Scenario: failed_convergence_retries_atomically
- **WHEN** convergence is forced to fail before commit and then rerun
- **THEN** the failed attempt moves no partial object set and the retry produces
  exactly one complete migrated state without duplicated rows or grants.

#### Scenario: production_era_prerequisites_precede_convergence
- **WHEN** a database released by commit 3a6770ff651a308bfae0e31b5c525705c356a5a5
  with all migrations through 0087 recorded runs the current release command
- **THEN** pending runtime-storage prerequisites and schema convergence complete,
  preserving existing object identities, rows, grants and ledger timestamps
- **AND** rerunning release makes no duplicate history or grant contributions.

#### Scenario: failed_legacy_prerequisite_retries_atomically
- **WHEN** a pending legacy prerequisite fails after beginning its changes
- **THEN** neither its changes nor its ledger entry survive
- **AND** retry applies it once while retaining earlier committed prerequisites.

#### Scenario: unsupported_legacy_ledger_rejected
- **WHEN** a legacy database lacks any migration recorded by the supported 0087 floor
- **THEN** release names the missing migrations and required intermediate upgrade
  without applying migrations or creating destination storage.

### Requirement: A new access rule needs a new, reviewed version

An app SHALL only gain a new access rule — such as who may read or act on
one of its tables — by shipping a new, reviewed version; Featherbase SHALL
NOT let an already-installed version quietly pick up a rule it didn't
originally declare. A new version MAY withdraw a rule its predecessor
declared; applying it SHALL remove only the grant that app created, and
record the withdrawal in the activity log. The image SHALL ship the installed
predecessor beside the new version so the upgrade can find it.

#### Scenario: An old version can't gain a new rule for free

- **WHEN** an app adds an access rule that its currently installed version
  never declared
- **THEN** using it requires installing that reviewed new version, previewed
  and turned on like any other upgrade

#### Scenario: A new version can withdraw a rule

- **WHEN** an upgrade's new version no longer declares an access rule its
  installed version declared
- **THEN** the preview lists the rule as withdrawn
- **AND** applying the upgrade removes the grant the app created, and no other
- **AND** the activity log records the withdrawal

### Requirement: A row with retained activity or an outdated view resists deletion

A row in an installed app's table SHALL NOT be deleted while it has a
comment, a recorded edit, an attached file or an active share, or when the
delete was made against an out-of-date view of it.

#### Scenario: A commented row resists deletion

- **WHEN** someone tries to delete a task that has a comment on it
- **THEN** the deletion is refused
- **AND** the task and its comment are both still there afterward

#### Scenario: An outdated view can't delete a row that has since changed

- **WHEN** someone tries to delete a row using a copy of it they loaded
  before someone else changed it
- **THEN** the deletion is refused

### Requirement: explicit_runtime_policy_upgrade

Package discovery SHALL validate read/action policy and required callback
declarations as immutable artifact contents. Missing policies SHALL NOT become
implicit unscoped grants. The host SHALL recognize exact historical version-1
artifacts for predecessor verification and reviewed upgrade planning without
executing undeclared actions. Install/restart SHALL expose their policy-upgrade
diagnostic while preserving data and unaffected contributions. Adding explicit
policies SHALL require a new package version and ordinary preview, upgrade and
activation; stored artifacts SHALL NOT be rewritten or automatically upgraded.
Pending/obsolete clients SHALL retain existing fail-closed identity behavior.

#### Scenario: tasker_policy_upgrade_preserves_work
- **WHEN** exact Tasker 2.0.0 is upgraded to a new artifact with explicit Table
  policies through a code-only cumulative migration and activated
- **THEN** existing work and retry identities remain intact and actions execute
  under current Table permissions, without imposing store roles on Tasker

#### Scenario: historical_artifact_is_not_relabelled
- **WHEN** a policy is inserted into an installed artifact without a new version
- **THEN** identity verification rejects it rather than trusting edited code

#### Scenario: policy_restart_is_fail_closed
- **WHEN** a required scope resolver/product authorizer is absent across restart
- **THEN** the protected contribution remains unavailable with a diagnostic
- **AND** restoring the exact artifact restores one registration, not duplicate gates

### Requirement: A failed installation leaves nothing behind

If installing an app fails, Featherbase SHALL leave nothing of it behind — no
tables, no access and no place in anyone's app catalog — so the admin can fix
the cause and install it again.

#### Scenario: An app with a broken access rule installs nothing

- **WHEN** an admin installs an app whose access rule names a role that
  doesn't exist
- **THEN** the installation is refused
- **AND** none of the app's tables exist and it is in no one's app catalog

### Requirement: An app can't take a name Featherbase uses itself

Featherbase SHALL refuse to offer an app whose name it already uses for its
own addresses, such as "featherbase" or "api", so an app can never stand in
front of Featherbase's own screens.

#### Scenario: A reserved name is refused

- **WHEN** an app is delivered under the name "api"
- **THEN** Featherbase does not offer it for installation and says the name
  is reserved

### Requirement: Only administrators manage apps

Installing, turning off, upgrading and inspecting installed apps SHALL be open
only to administrators. An ordinary member sees only the apps they may open.

#### Scenario: A member can't turn an app off

- **WHEN** an ordinary member tries to turn Tasker off or preview an upgrade
  of it
- **THEN** it is refused
- **AND** Tasker stays on

### Requirement: Customizing an app's table can't change what it is

An admin SHALL be able to adjust how an app's table is presented, such as its
label, but SHALL NOT be able to change its name, where its data is kept or
which app it belongs to. A change of that kind already on record SHALL be
refused rather than applied.

#### Scenario: Relabel, but not rename

- **WHEN** an admin gives one of an app's tables a new label and also tries
  to rename it
- **THEN** the new label shows
- **AND** the rename is refused and the table keeps its name

### Requirement: Access an app grants lasts only while it is on

Access an app gives people to shared Featherbase information, such as reading
comments, SHALL apply only while that app is on. Turning the app off SHALL
withdraw that access, unless another app that is still on grants the same.

#### Scenario: Turning off the only app that grants it

- **WHEN** Tasker is the only app letting members read comments and an admin
  turns Tasker off
- **THEN** members can no longer read comments
- **AND** turning Tasker back on gives that access back

### Requirement: Changing an app waits for work already under way

Turning an app off, or applying its upgrade, SHALL wait for saves already under
way in that app — including the follow-up work they trigger — to finish.
Anything that starts afterward SHALL see the change.

#### Scenario: Turning an app off during a save

- **WHEN** an admin turns an app off while a save and its follow-up work are
  still running
- **THEN** turning off waits until both finish, and what they saved is kept
- **AND** a save started afterward is refused

### Requirement: An open app from before an upgrade is asked to reload

Once an app's new version is active, a screen still running the previous
version SHALL be refused when it reads or saves, and told to reload, rather
than working against data shaped for the new version.

#### Scenario: A stale tab after an upgrade

- **WHEN** a colleague still has the previous version of an app open after an
  admin upgrades and activates it, and they save a change
- **THEN** the save is refused and they are asked to reload the app

### Requirement: An upgrade never goes backward or rewrites its history

Featherbase SHALL refuse an upgrade to the version already installed or an
older one, and SHALL refuse a new version that describes an upgrade step
already applied differently from how it was applied.

#### Scenario: A downgrade is refused

- **WHEN** an admin previews moving an app to an older version, or to the
  version already installed
- **THEN** the preview is refused and nothing changes

#### Scenario: Rewritten history is refused

- **WHEN** a new version describes an already-applied upgrade step
  differently
- **THEN** its preview is refused

### Requirement: A turned-off app stays off through an upgrade

Upgrading an app that is turned off SHALL leave it off once the new version is
activated; the admin turns it back on separately.

#### Scenario: Upgrading a turned-off app

- **WHEN** an admin upgrades and activates an app that was turned off
- **THEN** it stays off until the admin turns it on

### Requirement: An upgrade can reshape the app's own tables

A new version of an app SHALL be able to add and remove its tables, add a
column of any kind, change a column's label, choices, default, whether it is
required, unique or hidden, rename a column or a table, and remove a column.
A rename SHALL keep the rows, their history, the links to them and who may see
them. An upgrade SHALL change only the app's own tables, never Featherbase's
or the instance's.

#### Scenario: A renamed table keeps its rows and history

- **WHEN** an app's new version renames its Note table to Memo, and two notes
  with a comment on one of them exist
- **THEN** after the upgrade both rows are in Memo
- **AND** the comment still belongs to its row

#### Scenario: A table that decides people's scope stays guarded

- **WHEN** an app renames a table whose rows decide which places people cover
- **THEN** the renamed table still decides scope
- **AND** only a System Manager can still change its rows

### Requirement: A change of kind keeps every value

An upgrade SHALL change a column's kind only where every stored value carries
over, such as whole numbers to decimals or a date to a date and time. Any other
change of kind SHALL be refused: the app adds a new column, copies the data and
then removes the old one.

#### Scenario: Whole numbers become decimals

- **WHEN** an upgrade changes a quantity column from whole numbers to decimals
- **THEN** every quantity keeps its value

#### Scenario: A change that would lose values is refused

- **WHEN** a new version changes a number column into a date column
- **THEN** that version is refused before anything runs

### Requirement: Removing data is declared and counted first

A step that removes data — a table, a column, or values outside a column's new
choices — SHALL be declared as removing data in the app's version; an
undeclared one SHALL be refused. Before it runs, the upgrade's preview, the
release check and a rehearsal on a copy of the instance SHALL each say how many
rows or values that instance would lose, without ever showing the values.

#### Scenario: The preview counts what will go

- **WHEN** an admin previews an upgrade that removes a legacy code column held
  by two items, and a table of two notes
- **THEN** the preview says the upgrade removes 2 values and 2 rows
- **AND** nothing is removed until the admin applies it

#### Scenario: An undeclared narrowing is refused

- **WHEN** an upgrade narrows a column's choices while a row still uses a
  choice it drops, and the step is not declared as removing data
- **THEN** the preview refuses the upgrade and says how many values it would
  clear

### Requirement: Installing fresh and upgrading give the same tables

Installing a version of an app directly and upgrading to it from an earlier
version, one version at a time, SHALL give exactly the same tables, columns,
rules and access.

#### Scenario: Two routes, one result

- **WHEN** one instance installs version 0.3.0 of an app and another installs
  0.1.0 and upgrades to 0.2.0 and then 0.3.0
- **THEN** both have the same tables, columns, rules and access

### Requirement: A new table arrives with the access its version declares

A table an upgrade adds SHALL arrive with exactly the access its new version
declares for it, listed in the preview. Access to the tables the app already
had SHALL never widen through an upgrade.

#### Scenario: A new supplier table is readable by the clerks

- **WHEN** an upgrade adds a Supplier table that its version lets clerks read
- **THEN** the preview lists that access
- **AND** after the upgrade clerks can read suppliers

## Deferred

Marketplace discovery, code signing, isolating untrusted code, running more
than one server at once, removing an app or deleting its data outright, and
letting an app remember its own settings are not built yet.
