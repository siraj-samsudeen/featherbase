# Admin UI Feedback

## ADDED Requirements

### Requirement: Destination selection dismisses the command dropdown

Activating a command-bar destination SHALL dismiss its dropdown, even when the destination is already open. The user SHALL be able to reopen the command bar afterward; replaying a past search SHALL instead leave it available to edit and run.

#### Scenario: A destination leaves its page unobstructed

```gherkin
Given the user is viewing the Sign In Method list
When the user selects the Sign In Method destination from the command bar
Then the Sign In Method list is shown without the command dropdown
And the command bar can be reopened with its history intact
```

#### Scenario: A replayed search remains usable

```gherkin
Given the user has searched for Sign In Method
When the user replays that past search from the command bar
Then the search remains available to edit and run
```
