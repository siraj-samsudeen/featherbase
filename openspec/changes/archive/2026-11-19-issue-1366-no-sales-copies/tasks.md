## 1. Dash stops copying sales figures

- [x] 1.1 Tests: the report read reads no dataset and records no view; a Dive with its own pickers opens on the reader's first store A–Z; the manifest declares only the organisation's Dives.
- [x] 1.2 Remove the four sales datasets, the quick view, its notices and its rules; re-describe the empty quick view column as retired (0.13.43 → 0.13.44).

## 2. Every report opened is recorded

- [x] 2.1 Tests: opening any report's Dive writes one Access Log view; a refused or failed open writes none; an Access Log that can't record fails the open.
- [x] 2.2 Write the view when a Dive's session is opened, for every report.

## 3. The old Sales Target page is retired

- [x] 3.1 Remove the page, its routes, its dataset and its refresh, and what only it used; drop its cache tables.
