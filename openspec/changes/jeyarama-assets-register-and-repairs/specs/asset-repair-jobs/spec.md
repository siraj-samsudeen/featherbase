# Asset repair jobs

## ADDED Requirements

### Requirement: Report a fault from the asset

Any member SHALL be able to report a fault on an asset, saying what is wrong and how urgent it
is. The report SHALL become a repair job for that asset and its place.

#### Scenario: The AC stops cooling

```gherkin
Given store staff open the "Voltas 2-ton split AC" page
When they report "Not cooling" as Urgent
Then a repair job "Not cooling" is waiting for the AC in Avadi Store
```

### Requirement: Every job has a fix-by time

A job SHALL be due for fixing 4 hours after it is reported when Urgent, 1 day when High and
3 days when Normal. Until it is fixed or cancelled, Assets SHALL show the time left, or how late
it is once the time has passed.

#### Scenario: An urgent job runs late

```gherkin
Given "Not cooling" was reported as Urgent at 10:00
When it is 16:00 and the job is not fixed
Then the job shows it is late by 2 hours
```

#### Scenario: Raising the priority brings the time forward

```gherkin
Given "Door seal torn" was reported as Normal at 10:00
When a manager raises it to High
Then it is due for fixing at 10:00 the next day
```

### Requirement: Move a job from reported to fixed

Technicians and managers SHALL be able to assign a job to a technician and move it through
Reported, Assigned, In progress, Waiting for parts and Fixed, or cancel it. Store staff SHALL
NOT change a job once reported.

#### Scenario: Assigning a job

```gherkin
Given "Not cooling" is Reported
When a manager assigns it to Ravi
Then the job is Assigned to Ravi
```

#### Scenario: Store staff cannot close a job

```gherkin
Given "Not cooling" is Assigned to Ravi
When store staff try to mark it Fixed
Then the change is refused
```

### Requirement: A fixed job says what was done

A job SHALL become Fixed only with a note of the work done, and MAY record what it cost. The
asset's page SHALL list its past jobs.

#### Scenario: Fixing without a note

```gherkin
Given "Not cooling" is In progress
When Ravi marks it Fixed without saying what was done
Then the change is refused, asking what was done
```

#### Scenario: The asset's history

```gherkin
Given Ravi fixed "Not cooling" by "Refilled gas" for ₹2,400
When anyone opens the AC's page
Then its past jobs show "Not cooling", fixed, "Refilled gas", ₹2,400
```
