# Row Editing

## Purpose

Every Table automatically gets one form for opening, creating and editing its
rows — no per-Table screen has to be built. The form shows what changed,
saves valid edits, and never lets an invalid or stale save destroy work
silently.

## Requirements

### Requirement: Open or create a row

Opening one of a Table's rows SHALL show its current values in a form built
from that Table's fields, and creating a new row SHALL open the same kind of
form blank and ready to fill in.

#### Scenario: Open an existing row

- **WHEN** the user opens a row
- **THEN** its saved values appear in the form

#### Scenario: Start a new row

- **WHEN** the user creates a new row
- **THEN** a blank form opens, ready for input

### Requirement: Edit and save

Changing a field SHALL mark the form as not yet saved, and saving SHALL
store every changed value and confirm the save.

#### Scenario: Save an edit

- **WHEN** the user changes a field and saves
- **THEN** the form shows it as saved and keeps the new value

### Requirement: An invalid value blocks the save, in place

Saving with an invalid value SHALL save nothing and instead show an error
next to each field that failed, leaving everything the user typed on screen
to fix.

#### Scenario: Fix a rejected value

- **WHEN** the user enters an invalid value and saves
- **THEN** nothing is saved
- **AND** an error appears beside that field, with the typed value still there

### Requirement: A save that arrives too late is refused

If someone else has changed a row since the user opened it, saving over that
change SHALL be refused rather than silently overwriting it, and the user's
own entered values SHALL remain in the form so nothing is lost.

#### Scenario: Someone else changed it first

- **WHEN** the user tries to save a row that another person changed after the
  user opened it
- **THEN** the save is refused
- **AND** the values the user entered stay in the form

### Requirement: See a change made while the row is open

While a row is open, the user SHALL be told when someone else has just
changed it elsewhere, and be offered a way to bring in that latest version.

#### Scenario: Notified of a change elsewhere

- **WHEN** another person saves changes to the row the user currently has
  open
- **THEN** the user sees a notice that it changed elsewhere, with a way to
  load the latest version

### Requirement: Attach files to a row

The user SHALL be able to attach a file to a row, see every file attached to
it, open any of them, and remove one without disturbing the others.

#### Scenario: Attach and remove a file

- **WHEN** the user attaches a file to a row and later removes it
- **THEN** it is listed among the row's attachments until removed
- **AND** removing it takes it out of that list, leaving any other attachment
  untouched

### Requirement: Peek at a linked row without leaving the page

Clicking a link to another row SHALL open it in a read-only panel over the
current page rather than navigating away. From there the user can follow
another link deeper, step back one link at a time, or open what they're
looking at as a full page; closing the panel always returns to the page they
started from unchanged.

#### Scenario: Follow a chain of links and come back

- **WHEN** the user clicks a linked row, then clicks one of its own links, and
  then closes the panel
- **THEN** they see both linked rows in turn without leaving the original page
- **AND** closing the panel leaves them back on the original page

### Requirement: Each field gets a control that fits its type

On a row the user can change, the form SHALL give each field the control that
suits what it holds: a text box for text, a number box for numbers, a checkbox
for yes/no, a drop-down for a choice, a date picker for a date, and a larger
box for long text.

#### Scenario: Different fields, different controls

- **WHEN** the user opens a row they can change that has a text field, a
  number, a yes/no field, a choice and a date
- **THEN** each one appears as the control that suits it, filled with the row's
  saved value

### Requirement: Read-only and hidden fields

A field marked read-only SHALL show in the form but not accept edits, and a
field marked hidden SHALL not be shown at all.

#### Scenario: A locked field

- **WHEN** the user opens a row whose Table has a read-only field and a hidden
  field
- **THEN** the read-only field cannot be changed
- **AND** the hidden field is nowhere on the form

### Requirement: Pick a linked row by typing

A field that links to another Table's rows SHALL offer matching rows as the
user types, found and shown by their title (the value that names a row, such
as a customer's name) whenever that Table names one, rather than by their id;
it fills the field with the one they pick, and offers a way to create a new
row to link to.

#### Scenario: Find a customer by a few letters

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user types "Ltd" into a new order's customer and picks "Globex Ltd"
Then the user was offered only "Globex Ltd"
And the user sees the saved order's customer as "Globex Ltd"
```

### Requirement: Every form control can be found by its name

Every control on a form SHALL be tied to its visible label, so assistive tools
find it by that name and the name stays correct after the user edits, adds,
removes or reorders rows. A required marker never replaces the field's name.
Each cell in a grid of nested rows is named by its grid, column and row
position, so two grids with the same columns never clash.

#### Scenario: Find a field by its label

- **WHEN** a form shows a text field, a required field, a checkbox, a choice,
  a linked-row field and an attachment field
- **THEN** each control can be found by its label, and still can after the
  user edits one of them

#### Scenario: Tell repeated grid cells apart

- **WHEN** two grids of nested rows share the same column names and the user
  moves or removes a row
- **THEN** every cell is still named by its grid, column and current row
  position

#### Scenario: Controls keep their place when rows move

- **WHEN** the user edits, reorders or removes nested rows, saved or not yet
  saved
- **THEN** the cells that remain keep what the user typed and their keyboard
  focus

### Requirement: Attach buttons say which field they belong to

Each attach button on a form SHALL name both its action and its field, and
pressing it by keyboard SHALL open the file chooser for that field.

#### Scenario: Two attach fields on one form

- **WHEN** a form has two file fields and one image field and the user
  presses an attach button with the keyboard
- **THEN** the button's name says which field it is for, and that field's file
  chooser opens

### Requirement: A form script's on-load step sees the loaded row

A form script is a small piece of code a developer attaches to a Table to adjust its form. Its on-load step SHALL run once each time a row is opened, after the row has loaded, so it reads the saved values and changes only the fields it sets.

#### Scenario: An on-load step fills in one field

- **WHEN** a form script fills in a note as the form opens, and the user opens a row that already names its store
- **THEN** the note is filled in and the store is still there

#### Scenario: Saving doesn't run it again

- **WHEN** the user saves a row whose on-load step changed a field
- **THEN** the form shows the row as saved, with the value the step set

### Requirement: A row's fields arrive by importance

A row SHALL open by importance: its title first, then its links to other rows,
then the fields it requires, then the rest. The title is the value that names
a row, such as a parcel's label.

#### Scenario: The parcel leads with its label and its rack

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel
Then the user sees the parcel's fields in the order Label, Rack, Sender, Weight, Fragile, Instructions, Sent On and Photo
```

### Requirement: A Table laid out in sections opens in its builder's order

A row of a Table its builder laid out in sections (named groups of fields)
SHALL open in the Table's own order until the person picks another arrangement.

#### Scenario: The parcel counter keeps its two sections

```gherkin
Given a parcel counter table its builder laid out in two sections
And a parcel "Blue box" at the parcel counter
When the user opens that parcel at the parcel counter
Then the user sees its fields in the builder's two sections
```

### Requirement: A read-only row folds its empty fields into one line

Arranged by importance, a row the user can only read SHALL fold its empty
fields into one line that says how many there are and opens to show them.

#### Scenario: The parcel's empty note is folded away

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel
Then the user sees one empty field folded away
And the user does not see the parcel's note
```

#### Scenario: The parcel's note shows once its empty fields are opened

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel and opens its empty fields
Then the user sees the parcel's note
```

### Requirement: Who created or changed a row reads on one line at its foot

Arranged any way but the Table's own order, the fields that only record when a
row was created or changed, and by whom, SHALL show together on one line below
the rest.

#### Scenario: The parcel's bookkeeping sits at its foot

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel
Then the user sees when the parcel was created and who updated it on one line below its other fields
```

### Requirement: A read-only row shows each value by its type

On a row the user can only read, each value SHALL show by what it holds: a
mark for its type beside its name, numbers in even-width figures, yes or no as
a marker, a link as the linked row's name, and a file as its file name.

#### Scenario: The parcel's values read by their type

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel
Then the user sees each of the parcel's fields marked with its type
And the user sees the parcel's weight in even-width figures
And the user sees the parcel marked as fragile
And the user sees the parcel's rack as "Top"
And the user sees the parcel's photo as the file "blue-box.png"
```

### Requirement: Arrange a row's fields by data type

The user SHALL be able to group a row's fields by their type, such as numbers
or links, each group named.

#### Scenario: The parcel's weight is grouped with the numbers

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel and arranges its fields by data type
Then the user sees the parcel's Weight grouped with the numbers
And the user sees the parcel's Rack grouped with the links
```

### Requirement: Arrange a row's filled fields first

The user SHALL be able to show a row's filled fields first and its empty
fields after them.

#### Scenario: The parcel's empty note comes after its filled fields

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel and arranges its filled fields first
Then the user sees the parcel's note after every filled field
```

### Requirement: Arrange a row's links first

The user SHALL be able to show a row's links to other rows first and
everything else after them.

#### Scenario: The parcel's rack comes first

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel and arranges its links first
Then the user sees the parcel's Rack before every other field
```

### Requirement: Arrange a row's fields in the Table's own order

The user SHALL be able to show a row's fields in the Table's own order,
sections and all, with nothing folded away. The Table's own order is the order
its builder gave its fields; a connected table's is its source's column order.

#### Scenario: The parcel's fields in its source's order

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel and arranges its fields in the table's own order
Then the user sees the parcel's fields in the order Created On, Label, Weight, Note, Fragile, Instructions, Sent On, Photo, Sender, Rack and Updated By
```

### Requirement: Show a row's fields in one column or two

The user SHALL be able to show a row's fields in one column or in two.

#### Scenario: The parcel's fields in one column

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel and shows its fields in one column
Then the user sees each of the parcel's fields below the one before
```

### Requirement: A row opens as the user last arranged that Table

The arrangement and the number of columns SHALL be remembered for each person
and each Table, wherever they sign in; one person's choice never changes
another's.

#### Scenario: The parcel opens as the user left it

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
And the user arranged the parcel's fields by data type in one column
When the user opens that parcel again
Then the user sees the parcel's Weight grouped with the numbers
And the user sees each of the parcel's fields below the one before
```

#### Scenario: A colleague's parcel still opens by importance

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
And the user arranged the parcel's fields by data type in one column
And a colleague may read parcels and racks
When a colleague opens that parcel
Then the colleague sees the parcel's fields in the order Label, Rack, Sender, Weight, Fragile, Instructions, Sent On and Photo
```

### Requirement: Choose an adjustment without guessing names

A user editing a metadata adjustment SHALL choose its Table, an existing column or the whole Table, and a setting permitted for that target. Boolean settings SHALL offer a yes-or-no control. New adjustments SHALL receive an ID automatically. Changing a target SHALL discard dependent selections so an old column or value cannot silently apply to the new target.

#### Scenario: Hide a column without naming the adjustment

```gherkin
Given the user can adjust a Table with a column called "floor"
When the user saves an adjustment that hides "floor"
Then the adjustment is saved without the user supplying an ID
And the saved adjustment identifies its Table, "floor" and "hidden"
And the user can open the affected Table from the saved adjustment
```

#### Scenario: A different target requires a fresh selection

```gherkin
Given the user is preparing an adjustment that hides "floor"
When the user chooses a different Table for the adjustment
Then the old column, setting and value are cleared
```

#### Scenario: Whole-Table adjustments remain available

```gherkin
Given the user can adjust a Table with a column called "floor"
When the user saves a label adjustment for the whole Table
Then the adjustment is saved for the whole Table rather than a column
```

### Requirement: One adjustment for each setting

A Table, column and setting SHALL have at most one adjustment; empty column scopes all mean the whole Table. A duplicate creation or move SHALL be refused with guidance to edit the existing adjustment, while editing that same adjustment remains allowed.

#### Scenario: A second adjustment cannot compete with the first

```gherkin
Given the user has saved an adjustment that hides "floor"
When the user tries to add the same adjustment again
Then the user is told to edit the existing adjustment
And only the original adjustment is saved
```

#### Scenario: A move cannot replace another adjustment

```gherkin
Given the user has saved an adjustment that hides "floor"
When the user tries to move it to a setting that already has an adjustment
Then the user is told to edit the existing adjustment
And the original adjustment stays on its previous Table
```

### Requirement: A moved adjustment leaves no old effect

Saving an adjustment for a different Table SHALL remove its effect from the previous Table and apply it to the new Table, including when those Tables have already been viewed.

#### Scenario: Only the new target keeps the adjustment

```gherkin
Given the user has saved an adjustment that hides "floor"
When the user moves the adjustment to another Table
Then the old Table no longer hides its column
And the new Table hides the selected column
```

### Requirement: Pick a linked row inside nested rows

A link in a grid of nested rows SHALL offer the linked Table's matching rows as the user types and keep the
one they pick, as a link field on the form does. Text the user typed but never picked SHALL NOT be saved as
a link.

#### Scenario: A role is picked from the roles that exist

```gherkin
Given the user is adding a role to a person
When the user types "Sys" into the new role and picks "System Manager"
Then only roles matching "Sys" were offered
And after saving, the person has the System Manager role
```

#### Scenario: A typed role that was never picked is not saved

```gherkin
Given the user is adding a role to a person
When the user types "Store Boss" into the new role without picking one
Then the person cannot be saved until the role is picked
And the person has no Store Boss role
```

### Requirement: Read a row using its configured presentation

An existing read-only row with a reading presentation SHALL show its configured title, headers, body, optional attachment names and optional notice before its raw values. Unconfigured, editable and new rows SHALL retain the ordinary form.

#### Scenario: Read a configured reference notice

```gherkin
Given the user can read a reference notice with a configured reading presentation
When the user opens the reference notice
Then the reference notice uses its configured reading presentation
And the ordinary editable reference form remains available for writable rows
```

### Requirement: The arrange toolbar stays put

Choosing a column count SHALL change only the fields below the toolbar. The Arrange by and Columns controls SHALL NOT move.

#### Scenario: Choosing one column

- **WHEN** a person chooses **1** under Columns at desktop width
- **THEN** every toolbar control stays where it was and the fields alone narrow
