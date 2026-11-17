## ADDED Requirements

### Requirement: A reader reports an issue from the report
Every report SHALL offer "Report an issue" wherever Tickets runs on the instance. The reader SHALL choose what is wrong from Data looks wrong, Stock missing, Item ran out, Target too high or too low, or Something else, and MAY name the item, store or number and add a note. The ticket SHALL carry, untyped, the report, a link back to the view, the store and month on show, the Dive's filters, the reader's reach and job, and the time.

#### Scenario: A Team Leader says a target is too high

- **GIVEN** a Team Leader of Sarees and Kids Wear at Lakeside opens Sales versus target
- **WHEN** they choose "Target too high or too low", name "Kanchipuram silk target" and send
- **THEN** a ticket "Target too high or too low: Sales versus target" is raised as theirs
- **AND** it carries the report, a link back to the view, Lakeside, this month, their sections and job, and the time
- **AND** the panel links to the ticket and lists it among their open feedback on this report

### Requirement: The reader's own ticket, and only one
The ticket SHALL be raised in Tickets by the reader themselves, and a retried Send SHALL never raise a second ticket. Once sent, the reader SHALL see a link to their ticket and their open feedback on that report.

#### Scenario: A lost answer is retried

- **GIVEN** a reader's Send reached Tickets but its answer was lost
- **WHEN** they press Send again without changing anything
- **THEN** Tickets answers with the same ticket and raises no second one
