## 1. Sub-tickets in the Tickets app (#1397)

- [x] 1.1 Version step 0.2.23 adds `parent` to `tickets.ticket`; `create` and `edit` take it, one level only
- [x] 1.2 The queue lists tickets without a parent, counts a parent's sub-tickets, and a search marks a sub-ticket's parent
- [x] 1.3 A parent's page lists its sub-tickets; a sub-ticket's page links to its parent

## 2. The MotherDuck sync's umbrella (#1397)

- [x] 2.1 The sync files each ticket it raises under one umbrella, found by a marker
- [x] 2.2 The umbrella resolves when no sub-ticket is open and is reopened when a new one is raised
- [x] 2.3 A script for the owner re-parents the existing review tickets under the umbrella
