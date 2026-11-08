# Asset repair jobs

## Purpose
Faults reported from an asset become repair jobs with a fix-by time and a full timeline,
moved through to fixed by technicians and closed only when the store confirms the repair.

## Requirements

### Requirement: Report a fault from the asset

Any member SHALL be able to report a fault on an asset, saying what is wrong, how urgent it is and,
if earlier, when it stopped working. The report SHALL become a repair job for that asset and its
place.

#### Scenario: The AC stops cooling

```gherkin
Given store staff open the "Voltas 2-ton split AC" page
When they report "Not cooling" as Urgent
Then a repair job "Not cooling" is waiting for the AC at ATK 1501
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

### Requirement: A job keeps its whole timeline

A job SHALL record when the asset stopped working, when the fault was reported, when someone first
responded, when repair started and when it was restored. Assets SHALL set these as the job moves,
and they SHALL not move once set.

#### Scenario: From failure to restoration

```gherkin
Given "Door seal torn" was reported, saying the cold room stopped 10 minutes earlier
When Ravi is assigned, starts the repair and fixes it
Then the job shows when the cold room stopped, was reported, was responded to, repair started and was restored, in that order
And none of those times changes when the job is saved again
```

### Requirement: Move a job from reported to fixed

Technicians and managers SHALL be able to assign a job and move it through Reported, Assigned,
In progress, Waiting for parts and Fixed, or cancel it. Store staff SHALL NOT change a job once
reported.

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

A job SHALL become Fixed only with a note of the work done, and MAY record its cause, the spares
used, any outside service and what it cost. The asset's page SHALL list its past jobs.

#### Scenario: Fixing without a note

```gherkin
Given "Not cooling" is In progress
When Ravi marks it Fixed without saying what was done
Then the change is refused, asking what was done
```

### Requirement: The store confirms the repair

A fixed job SHALL close only when someone other than the technician who did the work confirms the
asset works again. A confirmed job SHALL NOT be reopened.

#### Scenario: Store staff confirm

```gherkin
Given Ravi fixed "Not cooling"
When store staff confirm it works
Then the job is closed, with who confirmed it and when
```

#### Scenario: The technician cannot confirm their own work

```gherkin
Given Ravi fixed "Not cooling"
When Ravi tries to confirm it
Then the confirmation is refused
```

### Requirement: Check cover before paying for work

A job SHALL show when its asset is still under warranty or AMC, so the technician checks cover
before chargeable work.

#### Scenario: Under warranty

```gherkin
Given the AC's warranty runs until 12 March 2027
When "Not cooling" is opened on 7 November 2026
Then the job shows the AC is under warranty until 12-Mar-2027
```
