# Tasks

## 1. All-or-nothing bulk changes (#332)

- [x] 1.1 Server tests first: a refused row leaves every selected row as it was and is named; a person without write access changes nothing; a connected Table tries every row and lists the failures.
- [x] 1.2 Add the `:bulk-edit` and `:bulk-delete` collection actions and call them from the list's bulk bar; the failed rows of a connected Table stay selected.
