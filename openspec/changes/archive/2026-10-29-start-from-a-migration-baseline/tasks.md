# Tasks

## 1. Starting point

- [x] 1.1 Generate the starting point from a freshly built database with a script that can regenerate it, leaving out everything that depends on where it was made.
- [x] 1.2 Keep the steps that read the instance's own settings as separate steps after it.
- [x] 1.3 Prove a fresh install from it equals one from the 139 changes and the fix: schema and every starting row.

## 2. Existing instances

- [x] 2.1 Take over a database with all 139 changes without running the starting point, and prove nothing but the fixes' record changes.
- [x] 2.2 Refuse a partly upgraded or older database before anything is written, naming the release that can upgrade it.

## 3. One mechanism

- [x] 3.1 Remove the patch runner, its command, its record and its callers.
- [x] 3.2 Remove the tests and code that only served the replaced changes.
