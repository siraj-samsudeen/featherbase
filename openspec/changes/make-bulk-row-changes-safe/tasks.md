# Tasks

## 1. All-or-nothing bulk changes (#332)

- [x] 1.1 Server tests first: a refused row leaves every selected row as it was and is named; a person without write access changes nothing; a connected Table tries every row and lists the failures.
- [x] 1.2 Add the `:bulk-edit` and `:bulk-delete` collection actions and call them from the list's bulk bar; the failed rows of a connected Table stay selected.

## 2. A refused change names the field (#540)

- [x] 2.1 Web test first: clearing a required field across selected rows names that field and why.
- [x] 2.2 The bulk bar shows each refused field by its label with the server's reason, for both the all-or-nothing refusal and a connected Table's failed rows.
