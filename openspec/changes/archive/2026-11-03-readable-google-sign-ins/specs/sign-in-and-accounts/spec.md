# Sign In And Accounts

## ADDED Requirements

### Requirement: An administrator reads a linked Google account by its address

On a person's sign-in methods, a linked Google account SHALL lead with its address and SHALL say when and
how it was linked and when it was last used. Google's account number SHALL be shown only when asked for,
never as the first thing the row says.

#### Scenario: A claimed Google invite reads as who and when

```gherkin
Given a person was invited by a Google address and has signed in with it
When a System Manager opens the person's sign-in methods
Then the Google sign-in leads with the person's address
And it says it was linked at first sign-in, and when it was last used
And Google's account number shows only under the sign-in's details
```
