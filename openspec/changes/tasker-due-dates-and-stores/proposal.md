## Why

Jeyarama Group's owner has run store work in Petpooja Tasks for a year. They check it for what is
late and which store it is late in. Tasker can show neither: a task has no date and no store. The
owner compared Tasker with Petpooja Tasks, Bordio, Lark, Akiflow and Zoho Projects, and picked
these two features to build first (`feature-comparison.md`, items 1 and 2).

## What Changes

- A task can have a start date and a due date, both optional. Tasker marks each unfinished task
  Overdue, Due today or Scheduled. Overdue means past its due date. Scheduled means its start date
  is still to come.
- Tasker keeps a list of the group's stores and warehouses, and a task can belong to one.
  Subtasks follow their parent's store.
- A new Stores page shows one row per store, plus tasks with no store and a total. The columns are
  Total, Ongoing, Completed, Overdue and Scheduled, and each task is counted in exactly one of
  them. Clicking a number lists those tasks.
- Task filters gain Store and Due.

Not included: limiting a store manager to their own store's tasks, a date-range picker, and home
summary cards.

## Capabilities

### New Capabilities

- `tasker-due-dates`: start and due dates, and seeing which tasks are late, due today or
  scheduled.
- `tasker-stores`: the store list, a task's store, and the store-wise summary.

### Modified Capabilities

None.

## Impact

- Tasker 3.1.0, with an upgrade step from 3.0.2. The step adds the store list and three task
  fields, and changes no existing rows.
- The development sample data gains Jeyarama's stores and warehouses, and dated tasks in them.
