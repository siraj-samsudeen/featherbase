# Parts

The scene: someone, a person or an agent, is about to build a page and needs to know which pieces already
exist, so that every page looks and behaves the same.

## Acceptance criteria

A spike. Proposed by Claude to make the question of reusable parts concrete. Not yet agreed by Siraj.

1. The Parts page shows every part by name, with where it lives and how it looks.

   | Part | Lives in |
   |---|---|
   | Button | parts.ts |
   | Link that looks like a button | parts.ts |
   | Tag | parts.ts |
   | Chip | page.ts |
   | Bar with the way back | page.ts |
   | Table | features/managing-data/browsing/browsing.ts |
   | Record | features/managing-data/changing/changing.ts |

2. No page writes by hand what a part already writes.
