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

### Requirement: Featherbase and every app keep one working address

An older link to a Featherbase screen SHALL still work, redirecting to its
current address and keeping the rest of what was being looked at intact.

#### Scenario: An old link still gets you there

- **WHEN** someone opens a Featherbase admin link saved from before its
  addresses changed
- **THEN** it lands on the same screen at the current address, showing the
  same thing that link pointed to

### Requirement: A new access rule needs a new, reviewed version

An app SHALL only gain a new access rule — such as who may read or act on
one of its tables — by shipping a new, reviewed version; Featherbase SHALL
NOT let an already-installed version quietly pick up a rule it didn't
originally declare.

#### Normative details for the whole requirement

A new version MAY withdraw a rule its predecessor
declared; applying it SHALL remove only the grant that app created, and
record the withdrawal in the activity log.

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
declarations as immutable artifact contents.

#### Normative details for the whole requirement

Missing policies SHALL NOT become
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

### Requirement: An app can give its staff tabs on a phone

An app MAY name the few places its staff move between, each with a short label
and one of Featherbase's icons. On a phone, Featherbase SHALL show them as a
row of tabs within reach of a thumb on that app's pages, with the open one
marked, and SHALL show none for an app that names none or on a wider screen.
An app SHALL NOT be accepted when its tabs could not be shown safely: fewer than
two or more than five, a label too long to fit, or a tab that leads outside the
app.

#### Scenario: A store app's tabs on a phone

- **WHEN** the user opens an app that names "Today" and "Targets" as its tabs,
  on a phone
- **THEN** both tabs show at the bottom of the screen, with the one for the page
  they are on marked, and tapping "Targets" takes them there

#### Scenario: A tab that leads outside the app is refused

- **WHEN** an administrator installs an app whose tab leads to the Admin screens
  or to another site
- **THEN** the app is not accepted, and nothing of it is installed

### Requirement: An upgrade can reshape the app's own tables

A new version of an app SHALL be able to add and remove its tables, add a
column of any kind, change a column's label, description (the line a form
shows under it), choices, default, whether it is required, unique or hidden,
rename a column or a table, and remove a column.

#### Normative details for the whole requirement

Changing a label or a
description SHALL change only what people read. A rename SHALL keep the rows,
their history, the links to them and who may see them. An upgrade SHALL change
only the app's own tables, never Featherbase's or the instance's.

#### Scenario: A renamed table keeps its rows and history

- **WHEN** an app's new version renames its Note table to Memo, and two notes
  with a comment on one of them exist
- **THEN** after the upgrade both rows are in Memo
- **AND** the comment still belongs to its row

#### Scenario: A table that decides people's scope stays guarded

- **WHEN** an app renames a table whose rows decide which places people cover
- **THEN** the renamed table still decides scope
- **AND** only a System Manager can still change its rows

#### Scenario: A corrected description reaches every form

- **WHEN** an app's new version corrects a column's description from
  "material group" to "subcategory"
- **THEN** the upgrade's preview says it removes nothing
- **AND** after the upgrade the form shows "subcategory" under that column

### Requirement: A change of kind keeps every value

An upgrade SHALL change a column's kind only where every stored value carries
over, such as whole numbers to decimals or a date to a date and time. A text
column SHALL become a link to a table only when every value on the instance
names a row of that table, and a link SHALL always become text. Any other
change of kind SHALL be refused: the app adds a new column, copies the data and
then removes the old one.

#### Scenario: Whole numbers become decimals

- **WHEN** an upgrade changes a quantity column from whole numbers to decimals
- **THEN** every quantity keeps its value

#### Scenario: A change that would lose values is refused

- **WHEN** a new version changes a number column into a date column
- **THEN** that version is refused before anything runs

#### Scenario: Codes become links when every code has a row

- **WHEN** an upgrade turns a plant's state code column into a link to State,
  and one plant holds a code State doesn't have
- **THEN** the upgrade is refused on that instance, naming the code, and
  nothing changes

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

### Requirement: Platform storage is explicit
Featherbase-owned relations and functions SHALL live in PostgreSQL schema
`featherbase`.

#### Normative details for the whole requirement

A fresh install SHALL create them there. Core logical identities
SHALL remain compatible and unqualified; application logical and physical
identities SHALL remain scoped. Runtime and migration paths SHALL resolve physical
relations deterministically without pooled mutable `search_path` routing.
Security-definer functions SHALL restrict name resolution and explicitly address
their dependencies.

`public.site` SHALL remain an explicitly named pre-tenant host registry. It SHALL
NOT be treated as tenant data or moved into the core schema. Site data SHALL remain
isolated in its selected site schema.

#### Scenario: A fresh install uses the platform schema
- **WHEN** a fresh database runs the production migration command
- **THEN** every Featherbase-owned object is in the platform schema, and only the
  site registry is at `public.site`

### Requirement: An app can bring its own scheduled jobs

An app SHALL be able to declare scheduled jobs, each with how often it runs by
default and what it does. Installing the app SHALL add each job to the
scheduled jobs page under the app's name, where an admin manages it like any
other scheduled job.

#### Scenario: A daily job arrives with the app

- **WHEN** the user installs an app that declares a daily job to disable
  people who have left
- **THEN** the scheduled jobs page lists that job under the app's name, set
  to run daily, and it runs without anyone starting it

### Requirement: An app's job can do only what it declares

An app's job SHALL run as itself, not as a person, and SHALL be able to do only
what the app declares for it: seeing the instance's people, disabling a person,
or emailing the System Managers. Anything else SHALL be refused and recorded,
and the job SHALL never disable an administrator.

#### Scenario: A job that disables people

- **WHEN** a job declared to disable people runs and finds a person who has
  left and a System Manager who has left
- **THEN** the person is disabled, with the job named as the one who did it,
  and the System Manager is left as they are

#### Scenario: A job tries something it did not declare

- **WHEN** a job declared only to see people tries to disable someone
- **THEN** the person stays enabled, the run is recorded as failed and is not
  retried, and the access log records the refusal

### Requirement: An app's jobs follow the app

Turning an app off SHALL stop its jobs, turning it on SHALL start them again,
and removing it SHALL remove them. An upgrade SHALL add, change or remove the
app's jobs as the new version says, once the new version is turned on, and
SHALL keep a cadence an admin chose.

#### Scenario: Turning the app off and on

- **WHEN** the user turns an app off and later back on
- **THEN** its jobs do not run while it is off, and run again once it is on

#### Scenario: An upgrade changes the jobs

- **WHEN** the new version of an app runs one job hourly instead of daily,
  adds a job, and drops another
- **THEN** the upgrade preview lists all three changes, and once the new
  version is turned on the scheduled jobs page matches it

### Requirement: An upgrade can't give a job new access

An upgrade SHALL NOT let a job do something its installed version was not
allowed to do; a job that would gain access SHALL need a reviewed install.

#### Scenario: A job that would gain the right to disable people

- **WHEN** the new version of an app lets a job disable people when the
  installed version only let it see them
- **THEN** the upgrade preview is refused and says why

### Requirement: A job name belongs to one owner

An app SHALL NOT take the name of a scheduled job that Featherbase or another
app already has; installing it SHALL be refused and leave nothing behind.

#### Scenario: A name already in use

- **WHEN** the user installs an app whose job would have the same name as an
  existing scheduled job
- **THEN** the install is refused, naming who has the job, and the existing
  job is unchanged

### Requirement: The platform is named Featherbase

The platform destination SHALL be named Featherbase wherever the user switches
between the platform and installed apps.

#### Scenario: A clean instance identifies the platform

```gherkin
Given the user is a System Manager on an instance with no installed apps
When the user inspects the destination switcher
Then the platform destination is named "Featherbase"
```

#### Scenario: An installed app preserves the platform name

```gherkin
Given the user is a System Manager with Tasker installed
When the user inspects the destination switcher while using Tasker
Then the platform destination is named "Featherbase"
And Tasker retains its own app name
```

### Requirement: An app owns its screen under the shared top bar

An app SHALL own its address, document, state, content and styling outside shared navigation. Featherbase SHALL serve only declared client files, preserve deep paths, queries and fragments across sign-in and refresh, and never replace missing content. The shared bar SHALL include app controls, theme and account, without styling or covering app content. An app screen SHALL NOT compete with a generated Home Page; authorized administrators retain access to its data.

#### Scenario: A missing piece stays missing

```gherkin
Given the user is using Tasker
When a piece of Tasker's content cannot load
Then that piece is shown as missing
And neither Tasker's home nor Featherbase replaces it
```

#### Scenario: Signing in returns to the app that was opened

```gherkin
Given the user is signed out
When the user opens a nested Tasker address with a selected task and signs in
Then the same address and selected task survive refreshing the page
```

#### Scenario: An app can be delivered without rebuilding core

```gherkin
Given Featherbase has been built without Tasker's client files
When built Tasker is installed
Then Tasker opens with the shared navigation without rebuilding Featherbase or adding an app-specific platform route
```

### Requirement: An app's page follows the person's theme

An app's page SHALL be told which theme, light or dark, the person sees: when the page opens and whenever it
changes, without a reload. When the person has chosen to follow the device, the theme told is the device's.
Featherbase SHALL NOT restyle the app's page itself; the app decides how to follow.

#### Scenario: The app's page follows the person's choice over the device's

```gherkin
Given the user has chosen the light theme on a device set to dark
When the user opens an app's page that follows the theme
Then the app's page is light
```

#### Scenario: A theme change reaches the open app's page

```gherkin
Given the user is on an app's page that follows the theme, in the light theme
When the user switches to the dark theme in the shared bar
Then the app's page turns dark without reloading
```

### Requirement: An app knows the roles of the person it acts for
An app's actions and reads SHALL be told which roles the signed-in person holds, so an app can let a role take a
step. They SHALL learn only that person's own roles, never another person's.

#### Scenario: Tickets offers a step to the holder of a role

```gherkin
Given a Data Quality Issue that Bala has marked fixed
And a person who holds the "Data Quality Verifier" role and is not involved in the ticket
When that person opens the ticket in Tickets
Then Tickets offers that person the verification
```

### Requirement: An app can choose its accent colour

An **App** SHALL be able to name an **accent**, one of the colours Featherbase provides, each made readable in light and dark. The accent SHALL colour the app's buttons and selected items, on its own page and in the shared bar and navigation over it. It SHALL leave the colours that carry meaning (errors, warnings, success) and every other app unchanged. An app that names no accent keeps Featherbase's own, and an accent Featherbase does not provide is refused when the app is installed.

#### Scenario: An app's page and navigation take its accent

```gherkin
Given Tickets names the green accent
When the user opens Tickets
Then Tickets' main buttons and its selected view in the shared navigation are green
When the user switches to the dark theme in the shared bar
Then they are the dark theme's green
```

#### Scenario: An app that names no accent keeps Featherbase's

```gherkin
Given Tasker names no accent
When the user opens Tasker
Then Tasker's selected view in the shared navigation is Featherbase's own blue
```

#### Scenario: An accent Featherbase does not provide is refused

```gherkin
Given an app names an accent that Featherbase does not provide
When a System Manager installs that app
Then the installation is refused and names the accents Featherbase provides
```

### Requirement: An upgrade needs only the new version

An upgrade SHALL need only the new version's files. What the installed version declared is
remembered when it is installed, so the server does not have to keep its files to move on from it.

#### Scenario: An app upgrades once its old files are gone

```gherkin
Given the user installed version 1 of an app and added a row to it
And the server now holds only version 2 of that app
When the user previews and applies the upgrade to version 2
Then the app is on version 2 and the row is still there
```

## Deferred

Marketplace discovery, code signing, isolating untrusted code, running more
than one server at once, removing an app or deleting its data outright, and
letting an app remember its own settings are not built yet.
