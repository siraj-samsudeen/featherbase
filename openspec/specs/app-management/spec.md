# app-management Specification

## Purpose
Administrators inspect available apps before choosing what to install, understand
the access and setup each app needs, and configure their instance without
rewriting the app's packaged declarations.

## Requirements

### Requirement: Inspect apps before choosing them

A System Manager SHALL be able to inspect the apps available on the server,
what each adds and may access, and the setup it needs before installing it.

#### Scenario: Tasker is available but not installed

```gherkin
Given the user is a System Manager on an instance with no installed apps
And Tasker is available on the server
When the user inspects Tasker
Then the user sees its version, required platform version, additions, permissions and setup requirements
And Tasker is identified as not installed
```

#### Scenario: A client app can be inspected without being installed

```gherkin
Given the user is a System Manager on an instance with no installed apps
And the checkout includes unbuilt Tasker and client app Warehouse packages
When the user inspects the available apps
Then both Tasker and Warehouse can be inspected
And the user can tell that each package needs preparation before installation
And neither app is installed automatically
And test fixtures are not offered as user apps
```

#### Scenario: Choosing an app reveals its details

```gherkin
Given the user is a System Manager viewing the available app list
When the user chooses Tasker from the list
Then Tasker's declarations and installation state are shown alongside the list
And the applicable preparation or installation action is clear
```

#### Scenario: No additional app packages are available

```gherkin
Given the user is a System Manager on an instance with no available apps
When the user inspects the available apps
Then the user is told how an operator makes a trusted app available
```

### Requirement: Install a chosen app

A System Manager SHALL be able to explicitly install an available app and see
the result, including any setup still needed before it can be used.

#### Scenario: Tasker is installed by choice

```gherkin
Given the user is a System Manager on an instance with no installed apps
And Tasker is available on the server
When the user chooses to install Tasker
Then Tasker is identified as installed
And the user can reach its instance configuration
```

#### Scenario: A source-only app is prepared by explicit choice

```gherkin
Given the user is a System Manager viewing an unbuilt Tasker package
When the user explicitly chooses to prepare and install Tasker
Then preparation progress is shown and Tasker is installed only after preparation succeeds
```

#### Scenario: Failed preparation leaves an app uninstalled

```gherkin
Given the user is a System Manager viewing a Tasker package that cannot be built
When the user explicitly chooses to prepare and install Tasker
Then Tasker remains uninstalled and the failure explains what to do next
```

#### Scenario: A colleague cannot install Tasker

```gherkin
Given the user is a colleague without System Manager access
And Tasker is available on the server
When the user tries to install Tasker
Then the user is refused
And Tasker remains uninstalled
```

### Requirement: Configure the instance without rewriting the app

A System Manager SHALL be able to reach an installed app's editable instance
settings and role mappings, while file-managed values remain locked.
Secret requirements SHALL be shown by name and presence, never by value.
The scenarios use Warehouse, a client app with a report account, linked tables
and a required warehouse secret.

#### Scenario: A setting managed by the instance file remains locked

```gherkin
Given the user is a System Manager with Warehouse installed
And its linked tables setting is file-managed while its report account is editable
When the user configures Warehouse
Then the user can change the report account
And the linked tables setting is locked with an explanation
And the app's packaged declaration is not editable
```

#### Scenario: A required secret has not been supplied

```gherkin
Given the user is a System Manager with Warehouse installed
And its required warehouse secret has not been supplied by the operator
When the user inspects Warehouse's setup
Then the user sees the secret's name and that it is missing
And the user is directed to supply it through the host environment
And no secret value is returned to the browser
```

### Requirement: See what this instance is running

A System Manager SHALL see, on the Apps page, the commit the instance was built from, linked to it and to the changes up to it, with that commit's title and when the server started. A build that cannot tell its commit SHALL say so rather than guess. Each app SHALL show what changed in its latest versions, newest first, with each issue reference linked to that issue.

#### Scenario: Check which build an instance runs

- **WHEN** a System Manager opens the Apps page on an instance deployed from commit a1b2c3d
- **THEN** they see commit a1b2c3d linked to that commit, its title with its pull request linked, and when the server started
- **AND** a link to the changes up to that commit

#### Scenario: A build that does not know its commit

- **WHEN** the server was built without being told its commit and has no git checkout
- **THEN** the Apps page says the commit is unknown, with no link

#### Scenario: See what changed in an app

- **WHEN** a System Manager chooses Tasker on the Apps page
- **THEN** they see what changed in each Tasker version, newest first
- **AND** each issue a change names links to that issue

#### Scenario: Others cannot see it

- **WHEN** a person who is not a System Manager asks for the Apps page's information
- **THEN** it is refused

### Requirement: A System Manager can tell an installed app is closed to them

A System Manager's app switcher SHALL list each installed, enabled app they can't open, greyed out so it can't be chosen, naming the roles that would open it. Anyone else's list SHALL hold only the apps they can open, and they SHALL be refused the list of closed apps. This SHALL NOT change who can open an app.

#### Scenario: A System Manager without the app's role

- **WHEN** a System Manager without the Tasker Member role opens the switcher on an instance with Tasker installed
- **THEN** Tasker is listed as "Tasker: you need the Tasker Member role" and can't be chosen

#### Scenario: Someone who isn't a System Manager

- **WHEN** a person who isn't a System Manager opens the switcher
- **THEN** an app they can't open isn't listed
