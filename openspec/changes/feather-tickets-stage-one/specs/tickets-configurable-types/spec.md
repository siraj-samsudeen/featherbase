# Tickets configurable types

## ADDED Requirements

### Requirement: An instance configures ticket types without a release
A System Manager SHALL be able to add a ticket type, add or remove its fields (type, label, choices, required) and set its states, as Tickets configuration rows. The entry form, the sidebar's request types and the ticket page SHALL render whatever the instance configured, and a new ticket SHALL be checked against its type's current fields.

#### Scenario: A configured Data Quality Issue type is used at once

```gherkin
Given a System Manager has configured a "Data Quality Issue" type with a required Urgency of Now or Later
When Anjali submits that Data Quality Issue without an urgency
Then the submission is refused as missing Urgency
When Anjali submits that Data Quality Issue with urgency "Later"
Then the ticket starts in "Open"
```

#### Scenario: A removed field is no longer asked for

```gherkin
Given a System Manager has configured a "Data Quality Issue" type with a required Urgency of Now or Later
And the System Manager has removed its Urgency field
When Anjali submits that Data Quality Issue without an urgency
Then the ticket starts in "Open"
```

#### Scenario: The configured type is offered in the sidebar and the form

```gherkin
Given a System Manager has configured a "Data Quality Issue" type with a required Urgency of Now or Later
When Anjali opens Tickets
Then that type is listed under Request types and offered in the new-ticket form
```

#### Scenario: Dates on the ticket page read day, month name and year

```gherkin
Given Anjali submitted a Data Quality Issue raised on "2026-11-04"
When Anjali opens that ticket's page
Then its raised-on date reads "04-Nov-2026" and no date on the page is written with slashes
```

#### Scenario: An issue can name a second system

```gherkin
Given Anjali submitted a Data Quality Issue for SAP that also concerns StyleHR
When support opens that ticket
Then both SAP and StyleHR are shown on the ticket
```

### Requirement: Configured types keep the app's safety guarantees
A configured type's entered values SHALL stay private to the requester and support, its state changes SHALL be recorded in append-only history, and only support SHALL move it between its configured states. Configuration SHALL never weaken the access type's verification, approval or scope-invalidation gates.

#### Scenario: A colleague sees only the summary of a configured ticket

```gherkin
Given Anjali submitted a Data Quality Issue with current value "78/499/1"
When the colleague opens that ticket
Then its summary is shown and "78/499/1" is not
```

#### Scenario: Support moves a ticket through its configured states

```gherkin
Given Anjali submitted a Data Quality Issue raised on "2026-11-04"
When support resolves that ticket as "Fixed in source"
Then history records it, it leaves the open queue, and reopening returns it to "Reopened"
```

### Requirement: A configured type can route to a default assignee
A type MAY name a link field and an instance owners Table. A new ticket SHALL then be assigned to the primary owner recorded for the linked value, read as the requester; with no readable primary owner it SHALL stay unassigned.

#### Scenario: The primary owner of a source system is the default assignee

```gherkin
Given the owners Table lists Bala as primary owner of SAP
When Anjali submits a Data Quality Issue for SAP
Then the ticket is assigned to Bala
```

### Requirement: A person field offers every Person the requester may see
A person field SHALL accept, and the form SHALL find by name, any Person the requester may read under the Person permission, including people who never used Tickets, and SHALL refuse anyone else.

#### Scenario: An issue is raised for someone who never used Tickets

```gherkin
Given a person who never used Tickets, whom Pat may see and Anjali may not
When Pat raises a Data Quality Issue for that person
Then the ticket shows that person's name, and Pat's form finds them by name
And the same issue from Anjali is refused
```
