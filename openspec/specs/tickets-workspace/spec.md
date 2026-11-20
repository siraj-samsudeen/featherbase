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

### Requirement: Feedback on a report
Tickets SHALL keep "Feedback on a report", raised from a report by the person themselves. Its details SHALL be only its known fields, its quick pick one of the five a report offers, and its link back to the view a path on this instance. They SHALL be private to the raiser and support, and the ticket SHALL start New with nobody assigned.

#### Scenario: A link that leaves the instance is refused

- **WHEN** a report raises feedback whose link back is "https://elsewhere.example"
- **THEN** Tickets refuses it and no ticket is created

### Requirement: Feedback on a report shows where it came from
The ticket page SHALL show feedback on a report under "From the report", the report a link back to the view. A person SHALL be able to read their own open feedback on one report.

#### Scenario: The raiser reads their open feedback on a report

- **GIVEN** a reader raised two pieces of feedback on Sales versus target and one on Stock on hand
- **WHEN** they ask for their open feedback on Sales versus target
- **THEN** they get the two, newest first, and nobody else's

### Requirement: The ticket address names what is open
Tickets' address SHALL name the view, the open ticket or the New ticket form, and the search, type and state filters, and SHALL change as the user moves, so that the address opened again shows the same thing and Back returns to the previous one.

#### Scenario: A copied ticket address reopens the ticket

- **WHEN** support opens a ticket and a colleague opens the address support copied
- **THEN** the colleague sees that ticket open

#### Scenario: Filters travel with the address

- **WHEN** the user opens a Tickets address that carries a search
- **THEN** the search box holds it and the list is filtered by it
