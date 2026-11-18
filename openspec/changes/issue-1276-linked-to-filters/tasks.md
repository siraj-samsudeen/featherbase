## 1. Server

- [x] 1.1 Back-link relationship filters and `not related` on every shape, scoped per hop. Verify `apps/server/test/related-filter.test.ts`.

## 2. List page

- [x] 2.1 Linked to… and Not linked to… in Add filter: Tables, rows with counts, chains with step counts, chips. Verify `apps/web/test/linked-filters.test.ts`, `apps/web/test/linked-to-filters.test.tsx`.
- [x] 2.2 The list's exact sum. Verify `apps/web/test/linked-to-filters.test.tsx`.
- [x] 2.3 Go there and Filter on every link cell, shared with the panel chips (`LinkActions`). Verify `apps/web/test/linked-to-filters.test.tsx`.

## 3. Explore retired

- [x] 3.1 Sidebar entry and list button removed; old addresses redirect; page, steps and split button deleted. Verify `apps/web/test/linked-to-filters.test.tsx`, `apps/web/test/admin-pages-gaps.test.tsx`.
- [ ] 3.2 Independent verifier against #1218's checklist items B1-B3, with screenshots.
