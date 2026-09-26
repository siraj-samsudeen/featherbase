# Printing

## Purpose

Any row can be turned into a clean, printable page — with no navigation or
menus around it — and either printed or saved as a PDF from there. A
print format gives that page a fixed layout and wording; a letterhead adds a
shared header and footer to it.

## Requirements

### Requirement: Print a row

Opening a row's print page SHALL show its values with nothing else around
them, ready to print or save as a PDF from the browser. A row the user
can't otherwise open can't be printed either.

#### Scenario: Print from a row's form

- **WHEN** the user opens a row's form and chooses to print it
- **THEN** a plain page with that row's values opens, with no menus or
  navigation on it

### Requirement: A print format fixes the layout and wording

A print format SHALL replace the plain layout with the one its builder wrote
for that kind of row, filled in with the row's own values. When a Table has
more than one print format, the user SHALL be able to pick which one to use,
and one can be marked as the one used when nobody picks.

#### Scenario: Switch between formats

- **WHEN** a row's Table has an "Invoice" format and a "Receipt" format and
  the user switches between them
- **THEN** the printed page changes to match whichever one is chosen

### Requirement: A letterhead adds a shared header and footer

A letterhead SHALL add its header and footer, filled in with the row's own
values, above and below whatever is being printed. One letterhead can be
marked as the one used by default; the user can still choose a different one
or leave it off.

#### Scenario: A default letterhead appears without choosing one

- **WHEN** a letterhead is marked as the default and the user prints a row
  without picking one
- **THEN** that letterhead's header and footer appear on the page
