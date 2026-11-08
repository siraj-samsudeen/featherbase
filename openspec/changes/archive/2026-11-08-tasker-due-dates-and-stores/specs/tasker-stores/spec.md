# Tasker stores

## ADDED Requirements

### Requirement: Keep a list of stores and warehouses

Tasker members SHALL share one list of the group's places of work, each a store or a warehouse,
and SHALL be able to add to it.

#### Scenario: A new store

```gherkin
Given the store list has no "Keelkattalai Store"
When a member adds "Keelkattalai Store" as a store
Then every member can choose "Keelkattalai Store" for a task
```

### Requirement: Tie a task to a store

The user SHALL be able to choose which store a task belongs to, and see it on the task. A subtask
SHALL belong to its parent's store.

#### Scenario: A task in a store

```gherkin
Given the user has a task "Reconcile stock variance"
When the user chooses "Keelkattalai Store" for it
Then the task shows "Keelkattalai Store"
```

#### Scenario: A subtask follows its parent

```gherkin
Given the task "Reconcile stock variance" belongs to "Keelkattalai Store"
When the user adds the subtask "Count the cold room"
Then the subtask shows "Keelkattalai Store"
```

### Requirement: See each store's work at a glance

Tasker SHALL show one row per store, a row for tasks with no store, and a total row. Each row
SHALL count its tasks as Completed, Overdue, Scheduled or Ongoing, every task in exactly one, and
give their Total. Cancelled tasks SHALL NOT be counted. A member SHALL see counts only for tasks
they can already open.

#### Scenario: A store's counts

```gherkin
Given today is 6 November 2026
And "Keelkattalai Store" has one done task, one overdue task, one scheduled task and two other open tasks
And it has one cancelled task
Then its row shows Total 5, Completed 1, Overdue 1, Scheduled 1 and Ongoing 2
```

#### Scenario: Someone else's private task is not counted

```gherkin
Given another member has a private task in "Keelkattalai Store"
Then the user's "Keelkattalai Store" row does not count it
```

### Requirement: Open the tasks behind a number

The user SHALL be able to open the tasks behind any count on the store summary.

#### Scenario: The late tasks in one store

```gherkin
Given "Keelkattalai Store" has the overdue task "Reconcile stock variance"
When the user opens its Overdue count
Then the user sees "Reconcile stock variance"
And no task from another store
```

### Requirement: Find tasks by store

The user SHALL be able to narrow any task list to one or more stores, or to tasks with no store.

#### Scenario: Only one store's tasks

```gherkin
Given the task "Reconcile stock variance" belongs to "Keelkattalai Store"
And the task "Diwali display change-over" belongs to "Avadi Store"
When the user narrows the list to "Keelkattalai Store"
Then the list shows "Reconcile stock variance"
And the list does not show "Diwali display change-over"
```
