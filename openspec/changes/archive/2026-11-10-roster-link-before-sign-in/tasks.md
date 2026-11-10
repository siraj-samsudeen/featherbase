## 1. Roster link

- [x] 1.1 Link every current roster row, matching an existing account; hold what a first sign-in holds. Verify `apps/server/test/roster-link.test.ts`.
- [x] 1.2 End a leaver's link and the roster-written identifiers; refuse an implausibly large batch. Verify `apps/server/test/roster-link.test.ts`.
- [x] 1.3 Scheduled job `link_roster` (migration 0157, off by default), `cli roster:link`, Dash switches it on.
