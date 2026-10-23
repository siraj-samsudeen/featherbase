# Tasks

- [x] 1.1 Failing server tests in `apps/server/test/sales-target.test.ts`: a two-store reader gets both stores and the default rule (most Sections, then lowest code); the `store` parameter is honoured on `/me`, `/report` and `/embed_session`; another store is 403 with nothing minted or read; a single-store reader is unchanged; an ambiguous code still gives no store. Then split `currentAssignment` into per-store assignments with `assignmentFor`.
- [x] 1.2 Failing page tests in `apps/web/test/sales-target-page.test.tsx`: a dropdown only for two or more stores; switching reloads the report for that store; a remembered store opens first; a remembered store the reader no longer has is ignored. Then the store switcher on the report page.
- [x] 1.3 Remove the `multiple_stores` refusal and the page's neutral "refused" card.
