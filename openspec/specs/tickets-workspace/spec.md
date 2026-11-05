# Tickets workspace

## Purpose
How Tickets sits inside Featherbase. A person moves around Tickets the way they move around every other app, and the top of the page goes to the work: the queue and the ticket being handled.

## Requirements

### Requirement: Tickets uses Featherbase's shared navigation

Tickets SHALL show its views and ticket types in Featherbase's shared app navigation, under the shared top bar, and SHALL draw no navigation, sign-in or account controls of its own.

#### Scenario: Moving between views in the shared navigation

```gherkin
Given the user is support staff with tickets assigned to them
When the user opens Tickets
Then Tickets' views are listed in the shared app navigation
And Tickets shows no navigation or account controls of its own
When the user chooses the view of tickets assigned to them
Then the queue shows only the tickets assigned to the user
```

#### Scenario: Narrowing the queue to one ticket type

```gherkin
Given the queue holds an access request and a data quality issue
When the user chooses the access request type in the shared app navigation
Then the queue shows the access request and not the data quality issue
```

### Requirement: The work comes first

When Tickets opens, the queue and the selected ticket SHALL be the first things on the page, with the ticket's state, the person it is assigned to and the actions the user can take now. No introductory text SHALL sit above them.

#### Scenario: The ticket and its actions are at the top

```gherkin
Given the user is support staff and a new access ticket waits in the queue
When the user opens Tickets and selects that ticket
Then the ticket's title, state and assignee are shown at the top of the page
And the actions the user can take on it now are offered beside them
```

### Requirement: Connection status stays out of the way

Tickets SHALL show whether its outside connections are set up as one short status in its navigation rather than as a banner over the work. The status SHALL lead someone who can change Tickets' settings to them, and never lead anyone else to a page they can't open.

#### Scenario: Unconfigured connections show as a short status

```gherkin
Given none of Tickets' outside connections is set up
When the user opens Tickets
Then a short status in the navigation says the connections are not set up
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
