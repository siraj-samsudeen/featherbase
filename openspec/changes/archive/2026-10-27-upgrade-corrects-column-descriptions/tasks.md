# Tasks

## 1. A description an upgrade can change

- [x] 1.1 A version's history may change a column's description, alone or with another change to that column; it replays forward and backward, and a description that is not text keeps the version from loading, pinned by server tests.
- [x] 1.2 The upgrade records the new description, or removes it, through the table engine, rewriting no row and rebuilding no table, and counts no losses, pinned by server tests.
- [x] 1.3 Installing 0.4.0 of the fixture app directly and upgrading through every version give an identical schema; the preview of the description-only upgrade is not destructive, loses nothing and changes no access, pinned by server tests.
