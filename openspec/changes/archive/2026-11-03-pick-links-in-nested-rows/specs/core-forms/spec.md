# Core Forms

## ADDED Requirements

### Requirement: Pick a linked row inside nested rows

A link in a grid of nested rows SHALL offer the linked Table's matching rows as the user types and keep the
one they pick, as a link field on the form does. Text the user typed but never picked SHALL NOT be saved as
a link.

#### Scenario: A role is picked from the roles that exist

```gherkin
Given the user is adding a role to a person
When the user types "Sys" into the new role and picks "System Manager"
Then only roles matching "Sys" were offered
And after saving, the person has the System Manager role
```

#### Scenario: A typed role that was never picked is not saved

```gherkin
Given the user is adding a role to a person
When the user types "Store Boss" into the new role without picking one
Then the person cannot be saved until the role is picked
And the person has no Store Boss role
```
