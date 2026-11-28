# tickets-sub-tickets Specification

## Purpose
A ticket can sit under a parent ticket, so many related tickets (such as the MotherDuck review tickets) read as one in the queue and are followed from the parent's page.

## Requirements

### Requirement: A ticket may sit under a parent ticket

A ticket SHALL have at most one parent ticket, given when it is raised or set and cleared later by support. Nesting SHALL be one level: a ticket with a parent cannot be a parent, a ticket with sub-tickets cannot be given a parent, and a ticket cannot be its own parent (#1397).

#### Scenario: Raised under a parent

- **WHEN** someone raises a ticket naming a parent ticket
- **THEN** the ticket is a sub-ticket of that parent

#### Scenario: No second level

- **WHEN** someone raises a ticket naming a sub-ticket as its parent
- **THEN** the ticket is refused, saying a sub-ticket cannot have sub-tickets

### Requirement: Sub-tickets are grouped under their parent

The queue SHALL list only tickets without a parent, a parent's row counting its sub-tickets and how many are open; a search SHALL still find a sub-ticket, marked with its parent. A parent's page SHALL list its sub-tickets, each a link with its state, open ones first, and a sub-ticket's page SHALL link to its parent (#1397).

#### Scenario: The queue shows the parent once

- **WHEN** a ticket has three sub-tickets, two of them open
- **THEN** the queue lists the parent, reading "3 sub-tickets, 2 open", and none of the three

#### Scenario: A search finds a sub-ticket

- **WHEN** someone searches for a sub-ticket's title
- **THEN** the queue lists it, marked as under its parent

### Requirement: A ticket links to where its work is done

A ticket's details MAY carry an open link, a label and a relative path on this site; Tickets SHALL refuse any other address. Whoever may read the ticket's details SHALL see the link as a button on its page (#1463).

#### Scenario: A ticket opens its work

- **WHEN** a ticket is raised with an open link to `/featherbase/admin/link-motherduck-accounts`
- **THEN** its page shows a button with the link's label that opens that page

#### Scenario: Another site is refused

- **WHEN** a ticket is raised with an open link to `https://elsewhere.example/x`
- **THEN** the ticket is refused, saying the link must be a relative path on this site
