# Row Editing

## ADDED Requirements

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

#### Scenario: The parcel desk keeps its two sections

```gherkin
Given a parcel desk table its builder laid out in two sections
And a parcel "Blue box" at the parcel desk
When the user opens that parcel at the parcel desk
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

## MODIFIED Requirements

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
