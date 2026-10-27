# Tasks

## 1. Line items (#341)

- [x] 1.1 Hide a sensitive line-item column when a row is opened, in the reply to a save, submit, cancel or amend, and in print.
- [x] 1.2 Drop a line-item write above the writer's access, so a hidden value is never overwritten or set.

## 2. Webhooks and rule emails (#340)

- [x] 2.1 Leave sensitive columns out of webhook bodies, on the row and its line items.
- [x] 2.2 Render a rule email's subject and message, when the rule fires, against the row without its sensitive columns.

## 3. Scheduled report emails (#338)

- [x] 3.1 Run the report as the schedule's creator, whether it is sent on schedule or sent now; refuse a creator who can no longer sign in.
- [x] 3.2 Attach every row the creator can see, past the first 500.
- [x] 3.3 Only the creator or a System Manager may change a schedule's report or recipients.

## 4. Comments and history (#342)

- [x] 4.1 Scope every read of comments and edits to rows the reader may open or that are shared with them.
- [x] 4.2 Keep a Table's edit list from a reader who can't see all its columns; the row's activity filters each change instead.
- [x] 4.3 The form's comment and activity panels read the row's activity.
