## ADDED Requirements

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
