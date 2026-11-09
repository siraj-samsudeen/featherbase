# tasker-due-dates Specification

## Purpose
Tasker lets a task carry a start date and a due date, and marks work that is late (Overdue) or
not started yet (Scheduled), so a store team sees what needs doing today and what has slipped.

## Requirements

### Requirement: Give a task a start and a due date

The user SHALL be able to give a task a start date, a due date, both or neither. A due date SHALL
NOT be earlier than the start date.

#### Scenario: A task with a due date

```gherkin
Given the user has a task "Reconcile stock variance"
When the user sets its due date to 4 November 2026
Then the task shows it is due on 4 November 2026
```

#### Scenario: A due date before the start date

```gherkin
Given the task "Reconcile stock variance" starts on 10 November 2026
When the user sets its due date to 4 November 2026
Then the due date is refused, saying it can't be before the start date
```

### Requirement: See which tasks are late, due today or scheduled

Tasker SHALL mark an unfinished task Overdue when today is past its due date, Due today on its
due date, and Scheduled while its start date is still to come. A finished or cancelled task SHALL
carry none of these marks.

#### Scenario: A late task

```gherkin
Given today is 6 November 2026
And the task "Reconcile stock variance" is due on 4 November 2026 and is not done
Then the task is marked Overdue
```

#### Scenario: A task not started yet

```gherkin
Given today is 6 November 2026
And the task "Reconcile stock variance" starts on 10 November 2026
Then the task is marked Scheduled
```

#### Scenario: A finished task is never late

```gherkin
Given today is 6 November 2026
And the task "Reconcile stock variance" is due on 4 November 2026
When the user marks it done
Then the task is not marked Overdue
```

### Requirement: Find tasks by when they are due

The user SHALL be able to narrow any task list to tasks that are Overdue, Due today or Scheduled.

#### Scenario: Only the late work

```gherkin
Given today is 6 November 2026
And the task "Reconcile stock variance" is overdue
And the task "Diwali display change-over" is scheduled
When the user narrows the list to overdue tasks
Then the list shows "Reconcile stock variance"
And the list does not show "Diwali display change-over"
```
