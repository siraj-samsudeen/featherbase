# Agent Access

## MODIFIED Requirements

### Requirement: A service account's agent acts as that account

An access token of a service account SHALL connect an agent too. The agent SHALL then act as the
service account, with only the account's own roles, and its changes SHALL be marked in history as
any agent's are.

#### Scenario: A service account's agent sees only what the account may read

```gherkin
Given a service account "nightly-sync" that can read "Customer" but not "Payroll"
When an agent connected with the account's access token asks which Tables it can work with
Then "Customer" is listed
And "Payroll" is not
```

#### Scenario: A service account's change is marked

```gherkin
Given an agent connected with the access token "Sync agent" of the service account "nightly-sync"
When the agent adds a customer "Dhan Agencies"
Then the customer's history shows "Automation (nightly sync)" added it
And it is marked as made through an agent with the token "Sync agent"
```
