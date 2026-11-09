## MODIFIED Requirements

### Requirement: History marks a change made through an agent

A change an agent makes SHALL appear in the row's history under the token's owner, as any of the
owner's changes does, and SHALL also be marked as made through an agent, with the label the
access token had at that moment. A person reading the history SHALL read the mark after the
owner's name, as "<owner> edited via <token label>". A change the owner makes in Featherbase
themselves SHALL carry no such mark.

#### Scenario: A change through an agent is marked

```gherkin
Given the user has connected an agent with their access token labelled "Claude on my laptop"
When the agent changes the city of "Acme Traders" to "Madurai"
Then the change in its history is by the user
And the history reads "edited via Claude on my laptop" after the user's name
```

#### Scenario: A change by hand is not marked

```gherkin
When the user changes the city of "Acme Traders" to "Madurai" themselves
Then the change in its history is by the user
And it is not marked as made through an agent
```
