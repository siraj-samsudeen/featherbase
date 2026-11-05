## MODIFIED Requirements

### Requirement: Configure the instance without rewriting the app

A System Manager SHALL be able to reach an installed app's editable instance
settings and role mappings, while file-managed values remain locked.
Secret requirements SHALL be shown by name and presence, never by value.

#### Scenario: A setting managed by the instance file remains locked

```gherkin
Given the user is a System Manager with Feather Dash installed
And its report identifier is file-managed while its report account is editable
When the user configures Feather Dash
Then the user can change the report account
And the report identifier is locked with an explanation
And the app's packaged declaration is not editable
```

#### Scenario: A required secret has not been supplied

```gherkin
Given the user is a System Manager with Feather Dash installed
And its required warehouse secret has not been supplied by the operator
When the user inspects Feather Dash's setup
Then the user sees the secret's name and that it is missing
And the user is directed to supply it through the host environment
And no secret value is returned to the browser
```
