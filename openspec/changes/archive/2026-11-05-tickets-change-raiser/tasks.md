## 1. Acceptance tests

- [x] 1.1 Steps and page object for the `tickets-raiser` scenarios, red against the running app

## 2. Platform

- [x] 2.1 `people.enabled` in the action and read context
- [x] 2.2 `documents.handOver`, refused unless the caller is a System Manager and the Table is the app's own

## 3. Tickets

- [x] 3.1 `change_raiser` action with its refusals, its history event and the private row handed over
- [x] 3.2 The immutable rule lets only this action through; a new raiser's name is recorded for readers
- [x] 3.3 Version 0.2.2 with an upgrade step from 0.2.1; instance previous versions list 0.2.0 and 0.2.1
