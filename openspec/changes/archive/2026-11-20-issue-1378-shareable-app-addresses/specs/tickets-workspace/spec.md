## ADDED Requirements

### Requirement: The ticket address names what is open
Tickets' address SHALL name the view, the open ticket or the New ticket form, and the search, type and state filters, and SHALL change as the user moves, so that the address opened again shows the same thing and Back returns to the previous one.

#### Scenario: A copied ticket address reopens the ticket

- **WHEN** support opens a ticket and a colleague opens the address support copied
- **THEN** the colleague sees that ticket open

#### Scenario: Filters travel with the address

- **WHEN** the user opens a Tickets address that carries a search
- **THEN** the search box holds it and the list is filtered by it
