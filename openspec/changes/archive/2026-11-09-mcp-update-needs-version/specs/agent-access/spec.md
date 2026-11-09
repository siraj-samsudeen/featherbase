## ADDED Requirements

### Requirement: A change never overwrites one the agent has not seen

When the agent changes a row, it SHALL say which version of the row it read. If someone changed the
row after that, or the agent says no version, nothing SHALL change and the agent SHALL be told to
read the row again.

#### Scenario: An agent's update of a row changed since it read it is refused

```gherkin
Given the agent has read "Acme Traders"
And the user has since changed its city to "Salem" themselves
When the agent changes the city of "Acme Traders" to "Madurai"
Then "Acme Traders" is still in Salem
And the agent is told it was changed after it read it
```

#### Scenario: An agent's update without the version it read is refused

```gherkin
When the agent changes the city of "Acme Traders" to "Madurai" without saying which version it read
Then "Acme Traders" is still in Chennai
And the agent is told to read the row first
```
