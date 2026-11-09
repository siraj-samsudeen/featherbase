# Tasker issues

## ADDED Requirements

### Requirement: Raise an issue

A Tasker member SHALL be able to raise an issue with a category, severity, store, occurrence
time, asset or area, impact, containment, an optional photo and an owning function. An issue SHALL
have at most one owner, and tasks SHALL be able to link to it as corrective work.

#### Scenario: A chiller fault

```gherkin
Given Meena is a Tasker member
When she raises a High "Equipment failure" issue at ATK Avadi for "Dairy chiller 2"
Then the issue is open with a response deadline and a fix deadline
```

### Requirement: Clock an issue by its SLA rule

An issue SHALL take its response time, fix time and clock from the SLA rule for its severity, or
from its category's own rule when one exists. A store-hours clock SHALL count only the store's
opening hours. The resolution clock SHALL stop while an approved pause lasts and once the issue
is submitted.

#### Scenario: Store hours skip the night

```gherkin
Given a High issue is raised at 21:00 with a fix time of 1 day in store hours from 09:00 to 22:00
Then its time on the clock at 10:00 next morning is 2 hours
```

### Requirement: Escalate an issue on time

Tasker SHALL notify the owner when assigned, remind the owner at 75% of the fix time, notify the
store manager and the function head at breach, and notify the director after the configured time
for a Critical breach. Each step SHALL happen once and SHALL be recorded in the issue's log. An
issue with no owner or no one to escalate to SHALL be listed as needing an owner.

#### Scenario: Breach

```gherkin
Given a High issue at ATK Avadi owned by Suresh in Facilities
And ATK Avadi's store manager is Meena and the Facilities head is Kumar
When its fix time passes without submission
Then Meena and Kumar are notified once and the issue shows it is breached
```

### Requirement: Pause only with approval

An owner SHALL be able to ask to pause an issue with a reason and a next review date. The clock
SHALL keep running until the store manager approves the pause.

#### Scenario: Unapproved waiting

```gherkin
Given Suresh asks to pause an issue while waiting for the vendor
When the store manager has not approved it
Then the issue's clock keeps running
```

### Requirement: Close an issue with verification

An owner SHALL submit an issue with a note on what was done. When the issue has a verifier, only
the verifier SHALL accept it or return it with a reason. A breach SHALL stay recorded after
closure, and reopening SHALL keep the time already used.

#### Scenario: Breach survives closure

```gherkin
Given an issue breached its fix time
When it is submitted and accepted
Then it is closed and still shows it breached
```
