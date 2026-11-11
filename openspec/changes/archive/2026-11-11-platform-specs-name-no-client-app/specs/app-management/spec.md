# App Management

## MODIFIED Requirements

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
