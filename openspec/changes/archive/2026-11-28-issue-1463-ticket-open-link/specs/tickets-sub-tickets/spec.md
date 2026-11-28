## ADDED Requirements

### Requirement: A ticket links to where its work is done

A ticket's details MAY carry an open link, a label and a relative path on this site; Tickets SHALL refuse any other address. Whoever may read the ticket's details SHALL see the link as a button on its page (#1463).

#### Scenario: A ticket opens its work

- **WHEN** a ticket is raised with an open link to `/featherbase/admin/link-motherduck-accounts`
- **THEN** its page shows a button with the link's label that opens that page

#### Scenario: Another site is refused

- **WHEN** a ticket is raised with an open link to `https://elsewhere.example/x`
- **THEN** the ticket is refused, saying the link must be a relative path on this site
