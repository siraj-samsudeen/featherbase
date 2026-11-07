# Report Access

## ADDED Requirements

### Requirement: A person sees only the reports given to them
A person SHALL see the union of the reports given to them directly, through a role they hold, through the job on their current Job Assignment, and through any bundle given by those routes. Nothing SHALL withhold a report. With no such row a person SHALL see no report, whether or not they are a System Manager. The answer SHALL be read fresh on every request.

#### Scenario: Someone with no assignment sees nothing

```gherkin
Given Asha has no report access
When Asha opens Dash
Then Asha sees the no-access page
And Asha is waiting for access
```

#### Scenario: A System Manager gets no automatic access

```gherkin
Given Sam is a System Manager with no report access
When Sam opens Dash
Then Dash opens
And Sam sees no reports
```

#### Scenario: Each route gives a report

```gherkin
Given "Stock ageing" is given directly to Asha
And "Team leader pack" holds "Sales to date"
And "Team leader pack" is given to the job Team Leader
And Asha's current job is Team Leader
When Asha opens her reports
Then Asha sees "Stock ageing" and "Sales to date"
```

#### Scenario: Removing a row takes effect on the next request

```gherkin
Given "Stock ageing" is given directly to Asha
When the row giving "Stock ageing" to Asha is removed
Then Asha's next request does not list "Stock ageing"
```

#### Scenario: Losing a role takes effect on the next request

```gherkin
Given "Stock ageing" is given to the role Store Reviewers
And Asha holds Store Reviewers
When Asha's Store Reviewers role is removed
Then Asha's next request does not list "Stock ageing"
```

#### Scenario: An ended job no longer gives a report

```gherkin
Given "Stock ageing" is given to the job Team Leader
And Asha's Team Leader job ended yesterday
When Asha opens her reports
Then Asha does not see "Stock ageing"
```

#### Scenario: Changing a bundle changes what people see

```gherkin
Given "Team leader pack" holds "Sales to date"
And "Team leader pack" is given directly to Asha
When "Sales to date" is taken out of "Team leader pack"
Then Asha's next request does not list "Sales to date"
```

### Requirement: A grant never widens which stores a person sees
A report with no store filter SHALL open for someone given it whose job reaches no store. A store-filtered report given to them SHALL NOT open and SHALL NOT count towards opening Dash, and the person lookup SHALL say why.

#### Scenario: Head office gets a company-wide report but not a store one

```gherkin
Given Hari's job reaches no store
And "Company summary" has no store filter and is given to Hari
And "Sales to date" filters by store and is given to Hari
When Hari opens Dash
Then Hari sees "Company summary"
And Hari does not see "Sales to date"
And the person lookup says "Given, but their job reaches no store" for "Sales to date"
```

### Requirement: A report outside the list does not open
Opening a report outside the person's list SHALL be refused on the server, before any token or filter goes out, whatever the browser sends.

#### Scenario: Asking for a report not given is refused

```gherkin
Given "Stock ageing" is not given to Asha
When Asha asks to open "Stock ageing" by its key
Then the request is refused
```

### Requirement: One access row gives one thing to one receiver
A Report Access row SHALL give exactly one report or one bundle to exactly one person, role or job. Any other mix, or a row repeating an existing one, SHALL be refused on save. A malformed row that reaches the reader SHALL give nothing.

#### Scenario: A row naming two receivers is refused

```gherkin
When a Report Access Manager saves a row giving "Stock ageing" to both Asha and the job Team Leader
Then the save is refused
```

#### Scenario: A repeated row is refused

```gherkin
Given "Stock ageing" is given directly to Asha
When a Report Access Manager gives "Stock ageing" directly to Asha again
Then the save is refused
```

### Requirement: A Report Access Manager manages access without being a System Manager
A Report Access Manager SHALL be able to write Report Bundle and Report Access, and SHALL NOT be able to write Permission, Has Role, Data Scope or any other access Table. Every change to Report Bundle and Report Access SHALL be in version history. Anyone without that role or System Manager SHALL NOT open the page, and their writes SHALL be refused on the server.

#### Scenario: The manager can give but can't change roles

```gherkin
Given Meera holds Report Access Manager
When Meera gives "Stock ageing" to Asha
And Meera tries to give Asha a role
Then the report is given
And the role change is refused
```

#### Scenario: Someone else can't give a report

```gherkin
Given Asha does not hold Report Access Manager
When Asha tries to give herself "Stock ageing"
Then the save is refused
```

### Requirement: The page shows who has what, and why
The Report access page SHALL give a report or bundle to a person, role or job, list who has what with its kind, who gave it and a Remove, confirm a removal by naming it, and look up a person to show each report they see and why.

#### Scenario: Looking up a person says why

```gherkin
Given "Team leader pack" holds "Sales to date"
And "Team leader pack" is given to the job Team Leader
And Asha's current job is Team Leader
When Meera looks up Asha on the Report access page
Then the page lists "Sales to date" because "Job Team Leader, through Team leader pack"
```

### Requirement: A person with no reports can ask
Dash SHALL open only for someone with at least one report, or who holds Report Access Manager or System Manager, failing closed. Anyone else opening it SHALL get the no-access page, which records an Access Request. The alert SHALL also go to Report Access Managers, who SHALL be able to read the waiting list. The request SHALL clear once the person can see at least one report.

#### Scenario: A request clears when a report arrives

```gherkin
Given Asha has no report access and has opened Dash
When Meera gives "Stock ageing" to Asha
Then Asha no longer shows as waiting for access
```
