# Permissions and Roles

## MODIFIED Requirements

### Requirement: Roles given to everyone who signs in

A System Manager SHALL be able to name, in System Settings, roles that every person holds without adding them to each Person. Only a System Manager SHALL change them, each SHALL be an existing role other than a platform role, and an instance settings file SHALL NOT carry them.

#### Scenario: A newcomer holds the role everyone holds

```gherkin
Given System Settings gives "Tasker Member" to everyone who signs in
When a person with no roles of their own signs in
Then they can do what Tasker Member may do
```

#### Scenario: Someone who signs in later holds it too, and a service account does not

```gherkin
Given System Settings names "Tasker Member" for everyone who signs in
When a person signs in for the first time
Then they hold Tasker Member
And a service account still doesn't
```

#### Scenario: Removing the role takes it only from those who held it that way

```gherkin
Given System Settings gives "Tasker Member" to everyone who signs in
And one person holds it only through the setting, and another was given it directly
When "Tasker Member" is removed from the setting
Then the first no longer holds it
And the second still does
```

#### Scenario: A platform role cannot be given to everyone

```gherkin
Given the user is a System Manager
When the user names System Manager in the setting
Then the save is refused with "System Manager cannot be given to everyone"
```

#### Scenario: A person's pages say where the role comes from

```gherkin
Given System Settings gives "Tasker Member" to everyone who signs in
And a person holds Tasker Member only through the setting
When a System Manager opens the person's access page
Then it says "everyone who signs in has it"
When a System Manager opens the person's Person form
Then it says "Everyone who signs in also holds Tasker Member, set in System Settings."
```
