# Tasks

## 1. All-or-nothing bulk changes (#332)

- [x] 1.1 Server tests first: a refused row leaves every selected row as it was and is named; a person without write access changes nothing; a connected Table tries every row and lists the failures.
- [x] 1.2 Add the `:bulk-edit` and `:bulk-delete` collection actions and call them from the list's bulk bar; the failed rows of a connected Table stay selected.

## 2. A refused change names the field (#540)

- [x] 2.1 Web test first: clearing a required field across selected rows names that field and why.
- [x] 2.2 The bulk bar shows each refused field by its label with the server's reason, for both the all-or-nothing refusal and a connected Table's failed rows.

## 3. Confirm before a bulk delete (#327)

- [x] 3.1 Write the numbered UI checklist on the issue; web tests first: the dialog names the row count, Cancel is focused, and Cancel, Escape or a click outside deletes nothing.
- [x] 3.2 The bulk bar's Delete opens a confirmation dialog matching Delete Table's; the existing bulk-delete tests and e2e confirm first.
- [x] 3.3 An independent verifier checks the UI checklist at 1280px and 375px in light and dark, and a separate reviewer checks the server change; differences are fixed.
