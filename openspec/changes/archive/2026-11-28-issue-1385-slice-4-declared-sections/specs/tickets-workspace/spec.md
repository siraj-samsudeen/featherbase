## MODIFIED Requirements

### Requirement: Connection status stays out of the way

Tickets SHALL show whether its outside connections are set up as one short status beside its queue's toolbar rather than as a banner over the work; the shared sidebar holds only rows (#1385). The status SHALL lead someone who can change Tickets' settings to them, and never lead anyone else to a page they can't open.

#### Scenario: Unconfigured connections show as a short status

```gherkin
Given none of Tickets' outside connections is set up
When the user opens Tickets
Then a short status beside the queue's toolbar says the connections are not set up
And no connections banner is shown above the queue
```

#### Scenario: Only someone who can change the settings is led to them

```gherkin
Given none of Tickets' outside connections is set up
When a System Manager opens Tickets
Then the status leads to Tickets' settings
When the user opens Tickets
Then the status leads nowhere
```
