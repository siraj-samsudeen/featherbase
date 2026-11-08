# Tasker verified closure

## ADDED Requirements

### Requirement: Name who verifies a task

A shared task SHALL be able to have a verifier, who SHALL be a Tasker member other than the
person the task is assigned to. A project SHALL be able to name a default verifier, which a new
task in that project SHALL take unless that person is its assignee.

#### Scenario: A project's default verifier

```gherkin
Given the project "Diwali readiness" has Meena as its default verifier
When Ravi adds the task "Fix the billing counter lights" to it
Then the task's verifier is Meena
```

#### Scenario: The assignee cannot verify

```gherkin
Given the task "Fix the billing counter lights" is assigned to Ravi
When someone makes Ravi its verifier
Then the change is refused, saying the verifier can't be the person doing the task
```

### Requirement: Acknowledge an assigned task

When a task is assigned to someone else, it SHALL show that the assignee has not acknowledged it
until the assignee does. A task a person assigns to themselves SHALL count as acknowledged. Only
the assignee SHALL be able to acknowledge.

#### Scenario: A new assignment

```gherkin
Given Meena assigns "Fix the billing counter lights" to Ravi
Then the task shows "Not acknowledged by Ravi"
When Ravi acknowledges it
Then the task no longer shows it is not acknowledged
```

### Requirement: Close a verified task only through its verifier

A task with a verifier SHALL NOT be marked Done by ticking it. Someone other than the verifier
SHALL submit it with a note on what was done, and it SHALL become "Submitted for verification".
Only the verifier SHALL accept it, which SHALL mark it Done and record who verified it and when.
A task without a verifier SHALL be marked Done as before.

#### Scenario: Submit and accept

```gherkin
Given "Fix the billing counter lights" is assigned to Ravi and Meena verifies it
When Ravi marks it Done
Then it is refused, saying to submit it for verification
When Ravi submits it with the note "Replaced both tube lights"
Then it shows "Waiting for Meena to verify"
And it is on Meena's "To verify" page
When Meena accepts it
Then it is Done, verified by Meena
```

#### Scenario: A submission needs a note

```gherkin
Given "Fix the billing counter lights" has a verifier
When Ravi submits it without a note
Then it is refused, saying to add a note on what was done
```

### Requirement: Return a submitted task with a reason

The verifier SHALL be able to return a submitted task with a reason, which SHALL put it back In
progress and count the return. Reopening a verified task SHALL keep its earlier closure in the
task's history.

#### Scenario: Return with a reason

```gherkin
Given Ravi submitted "Fix the billing counter lights" for Meena to verify
When Meena returns it with the reason "Left counter still flickers"
Then it is In progress and shows "Returned: Left counter still flickers"
And it has been returned once
```

### Requirement: Move a due date only with a reason

Once a task has a due date, changing it SHALL need a reason. Tasker SHALL keep the first due date
and the number of times it was moved, and show both.

#### Scenario: An extension

```gherkin
Given "Fix the billing counter lights" is due on 7 November 2026
When Ravi moves it to 10 November 2026 without a reason
Then it is refused, saying to give a reason
When Ravi moves it to 10 November 2026 because "Electrician on leave"
Then the task shows "was 07-Nov-2026 · extended 1 time"
```

### Requirement: Cancel only with a reason

Cancelling a task SHALL need a reason, which the task SHALL keep.

#### Scenario: Cancel without a reason

```gherkin
Given the task "Dropped supplier visit"
When someone cancels it without a reason
Then it is refused, saying to give a reason for cancelling
```
