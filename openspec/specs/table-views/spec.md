# Table Views

## Purpose

A view is a named filter on one Table, such as the sites that are stores. It
holds no rows of its own and gives nobody access: its rows are its base
Table's rows, read and changed under the base's rules. A link can name a view,
so it can only point at the rows that belong there. A view is not a saved
view, which is one person's filter on a list.

## Requirements

### Requirement: A view is a named filter on one Table

A System Manager SHALL be able to define a view from a Table (its base) and one or more filters on the base's own columns. A view SHALL hold no rows and need no storage of its own: its rows are the base rows its filters match, now and later. It SHALL show its base's columns, and have its own list page that says what it is a view of.

#### Scenario: Stores are the sites that are stores

- **WHEN** a System Manager makes a view "Store" of Site, filtered to sites that are stores
- **THEN** the Store list shows only those sites, and says it is a view of Site
- **AND** opening one of its rows opens the Site row

### Requirement: A view never widens access

A view SHALL have no grants, access policy or Data Scopes of its own. Reading a view SHALL be reading its base under the base's own rules, with the view's filter added, on every road: lists, counts, summaries, search, pickers, row titles and export. A view's filter SHALL apply even to someone who can't see the column it filters on. Granting access or adding a Data Scope on a view SHALL be refused, pointing at the base.

#### Scenario: Someone who can't read the base can't read the view

- **WHEN** a person without access to Site opens the Store view, or a link picker that names it
- **THEN** they are refused, exactly as they are on Site

#### Scenario: A Data Scope on the base narrows the view too

- **WHEN** a person's Data Scope limits the sites they see
- **THEN** the Store view shows only their stores

### Requirement: A view's rows are changed as base rows

Every write addressed to a view SHALL be refused with a plain message naming the base: creating, saving, deleting or retiring rows, importing, comments, shares, tags and assignments. The same rows SHALL be changed by opening them on the base.

#### Scenario: Adding a row to a view

- **WHEN** someone tries to add a row to the Store view
- **THEN** it is refused, and the message says to open the Site row instead

### Requirement: A link can name a view

A link column SHALL be able to name a view. Its picker SHALL offer only the view's rows, and saving a value outside the view SHALL be refused. The link SHALL store the base row's id, so a column can move between the base and its views as a metadata change only; moving it to a view SHALL report any values already outside that view and refuse the move.

#### Scenario: A sale can only name a store

- **WHEN** a Sale's store column links to the Store view and someone picks a warehouse
- **THEN** the save is refused

#### Scenario: Moving a link to a view with values outside it

- **WHEN** a link column to Site is moved to the Store view while some rows name a warehouse
- **THEN** the move is refused and names those values

### Requirement: A row that leaves a view keeps its links

When a base row stops matching a view, rows that already link to it through that view SHALL keep the link and still save while that value is unchanged, and SHALL show that the value is outside the view.

#### Scenario: A store closes

- **WHEN** a site linked from a sale stops being a store
- **THEN** the sale still opens and saves, and its store column says the site is outside the Store view

### Requirement: Links to a view count as links to its base

A link that names a view SHALL protect and follow the base row exactly as a link to the base does: it blocks the row's deletion, follows a rename of the row, and appears in the row's backlinks, connections, purge preview and activity.

#### Scenario: Deleting a store that a sale names

- **WHEN** someone deletes a site that a sale links to through the Store view
- **THEN** the delete is refused, naming the sale

### Requirement: The base keeps what its views depend on

Renaming, retyping or removing a column a view filters on SHALL be refused while the view exists. Deleting a base that has views SHALL be refused, naming them. Renaming the base SHALL carry its views along. Deleting a view SHALL remove only the view: the base rows stay.

#### Scenario: Removing the filter column

- **WHEN** a builder removes Site's "is store" column while the Store view filters on it
- **THEN** the change is refused and names the Store view

### Requirement: Where views are listed

Views SHALL be left out of global search, which finds rows on their base, and of the Explore start list. A view SHALL never make the Admin or a Table listing available to someone who has no Table access. Import into a view SHALL be refused. Home pages and the command bar MAY offer a view to anyone who can read its base, without an option to create rows in it.

#### Scenario: Searching for a store

- **WHEN** someone searches for a store's name
- **THEN** it is found once, as a Site row
