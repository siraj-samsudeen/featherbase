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

### Requirement: A row can be downloaded as a PDF

The user SHALL be able to download a row as a PDF showing the same page the
print view shows, with the chosen print format and letterhead. The download is
recorded as a print by that user, and a row the user can't open can't be
downloaded.

#### Scenario: Download a row

- **WHEN** the user downloads a row as a PDF
- **THEN** the PDF carries the row's values
- **AND** a print by that user is recorded

#### Scenario: Not allowed to open the row

- **WHEN** a user who can't open a row asks for its PDF
- **THEN** it is refused and no print is recorded

### Requirement: A print format fixes the layout and wording

A print format SHALL replace the plain layout with the one its builder wrote
for that kind of row, filled in with the row's own values. When a Table has
more than one print format, the user SHALL be able to pick which one to use,
and one can be marked as the one used when nobody picks.

#### Scenario: The default format is used until the user picks another

- **WHEN** a table has an "Invoice" format marked as the default and the user
  prints a row without choosing a format, then chooses the standard layout
- **THEN** the first print uses the invoice wording
- **AND** the standard layout shows the row's values with no invoice wording

#### Scenario: Switch between formats

- **WHEN** a row's Table has an "Invoice" format and a "Receipt" format and
  the user switches between them
- **THEN** the printed page changes to match whichever one is chosen

### Requirement: A letterhead adds a shared header and footer

A letterhead SHALL add its header and footer, filled in with the row's own
values, above and below whatever is being printed. One letterhead can be
marked as the one used by default; the user can still choose a different one
or leave it off.

#### Scenario: Only one letterhead is the default

- **WHEN** another letterhead is marked as the default
- **THEN** the earlier one stops being the default, and the new one appears
  on prints

#### Scenario: Choose another letterhead or none

- **WHEN** the user prints a row choosing a branch letterhead, and then prints
  it again choosing no letterhead
- **THEN** the first print carries the branch letterhead instead of the default
- **AND** the second carries no letterhead at all

#### Scenario: A default letterhead appears without choosing one

- **WHEN** a letterhead is marked as the default and the user prints a row
  without picking one
- **THEN** that letterhead's header and footer appear on the page

### Requirement: A print format can name its letterhead

A print format MAY name the letterhead it prints with. That letterhead SHALL be
used instead of the default, unless the user chooses another or leaves it off.

#### Scenario: A format with its own letterhead

- **WHEN** a print format names a branch letterhead while another letterhead
  is the default, and a row is printed with that format
- **THEN** the branch letterhead appears and the default one does not
