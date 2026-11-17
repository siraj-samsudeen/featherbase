# Agent Access

## MODIFIED Requirements

### Requirement: Connect an agent with an access token

The user SHALL be able to connect an agent to Featherbase at the instance's own address with one
of their access tokens, or by signing in (Agent Sign-In). The agent SHALL then act as the token's
owner, with exactly the owner's access. A signed-in browser alone SHALL not open this connection.

#### Scenario: The agent works as the user

```gherkin
Given the user has connected an agent with their access token
When the agent adds a customer "Dhan Agencies"
Then the customer's history shows the user added it
```

#### Scenario: Without a token the agent is turned away

```gherkin
Given the user is signed in to Featherbase in their browser
When an agent connects without an access token
Then the connection is refused and no Table is reachable
```
