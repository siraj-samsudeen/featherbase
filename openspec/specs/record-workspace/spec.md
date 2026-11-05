# Record Workspace

## Purpose
A row's page keeps the user's attention on the row itself: its own work stays prominent, Table
administration and occasional operations stay out of the way, and optional collaboration shows
only where a Table turns it on.

## Requirements

### Requirement: Concentrate on the current row

The user SHALL be able to switch purposeful areas of a row without losing unfinished edits. Primary save and applicable workflow actions SHALL stay prominent; occasional record operations SHALL be grouped separately and reachable by keyboard.

#### Scenario: Unfinished work survives consulting activity

```gherkin
Given the user can edit the Plant row for Tenkasi
When the user changes its name and consults its activity before returning to work
Then the unfinished name is still present and can be saved
And the row's print and related navigation remain reachable
```

### Requirement: Distinguish row work from Table administration

The list SHALL keep creation, personal column choices, filtering and view selection compact and separate from grouped occasional operations and Table administration. Existing bulk operations SHALL be offered only while rows are selected, and clearing selection SHALL withdraw them without changing the rows.

#### Scenario: Selection reveals operations on rows, not the Table

```gherkin
Given the user manages the Plant Table containing Tenkasi
When the user selects Tenkasi in its list
Then the selection offers deletion of rows separately from deletion of the Table
And clearing the selection removes the row operations without changing Tenkasi
```

#### Scenario: Ordinary readers do not get Table administration

```gherkin
Given the user can only read the Plant row for Tenkasi
When the user consults its list views and related navigation
Then the list does not offer Table administration
And Tenkasi remains readable
```

### Requirement: Offer only authorized row operations

Existing-row controls SHALL use fresh server-derived display advice only after an authorized row read. Advice SHALL preserve each operation's ownership, scope and sharing rules, not authorize mutations. A write share SHALL NOT grant rename or delete. Collaboration SHALL use its own operation's grants, not parent-write permission; explicitly enabled tags SHALL remain reader-writable.

#### Scenario: A reader sees only available enabled collaboration

```gherkin
Given the user reads Tenkasi with collaboration enabled but no collaboration grants
When the user consults Tenkasi's available operations
Then Tenkasi is read-only without save, rename or delete operations
And assigning, uploading and composing discussion are absent
But the reader can still label Tenkasi with a tag
And selecting Tenkasi offers no unavailable bulk mutations
```

### Requirement: Enable collaboration deliberately without hiding existing content

Assignments, tags, files and discussion SHALL each need explicit Table-level UI enablement, off by default for existing and new Tables. Disabled features SHALL offer no add, edit or remove controls, but their existing content SHALL remain readable under the original access protections; enablement SHALL grant no server permission.

#### Scenario: Existing collaboration remains readable when disabled

```gherkin
Given Tenkasi has an assignment, a tag, a file and a discussion
When the user opens Tenkasi with collaboration disabled
Then the existing collaboration is readable without collaboration mutation controls
And the user can still consult its audit history
```

#### Scenario: Only explicitly enabled collaboration can be added

```gherkin
Given the Plant Table explicitly enables tags alone
When the user labels Tenkasi with a tag
Then the tag is saved and the other empty collaboration features stay absent
```

### Requirement: Read discussion once alongside its history

Discussion and recorded edits SHALL remain available together chronologically in one activity area, without a duplicate discussion panel. Enabling discussion SHALL make its existing authorized composition workflow discoverable there.

#### Scenario: Discussion is not duplicated across areas

```gherkin
Given Tenkasi has a discussion and a recorded edit
When the user consults its activity
Then the discussion and edit appear together once
```

### Requirement: Navigate related rows through one contextual workspace

Related SHALL offer one searchable path selector beside the selected native list. Empty paths SHALL stay selectable and quieter. Table/Column/via paths, mandatory filters, permission-scoped counts/rows, owner breadcrumbs, full-list/peek/new navigation and unfinished Work edits SHALL retain their context and existing permissions as illustrated below.

Example names are acceptance fixtures, not shipped app schema.

#### Scenario: Distinct paths to the same Table include an empty relationship

```gherkin
Given North workshop has two readable Lab Task relationships through project and review_project
And project has two related rows while review_project has none
When the user selects review_project in Related
Then the native list shows no rows for review_project
And the single relationship selector keeps both paths available with their separate counts
```

#### Scenario: Relationship search does not change the selected row scope

```gherkin
Given review_project is selected among North workshop's two Lab Task relationships
When the user searches relationships for review
Then the selector shows one matching relationship out of two
And the selected review_project list still shows zero rows
```

#### Scenario: Record search retains the owner and selected path

```gherkin
Given North workshop has Prepare workshop and Review materials through project
And another project has Review budget through project
When the user searches North workshop's project relationship for Review
Then only Review materials is listed
And clearing record search restores only North workshop's project rows
```

#### Scenario: Work survives consulting a related path

```gherkin
Given the user can edit North workshop
When the user changes its region to Unfinished North and consults Related before returning to Work
Then Unfinished North remains present as an unsaved edit
And the saved region has not changed
```

#### Scenario: Related navigation retains context and existing capabilities

```gherkin
Given the user can read North workshop's project relationship and create related Lab Task rows
When the user consults that relationship
Then breadcrumbs identify North workshop, Related and the project path without a second Home root
And Open full list and permitted peek retain the project relationship's filters
And new related-row navigation prefills project with North workshop's row identifier
```

#### Scenario: Related navigation grants no new access

```gherkin
Given the user may read only one of two Lab Task rows related to North workshop and may not create Lab Task rows
When the user consults North workshop's project relationship
Then the relationship count and native list include only the readable row
And no related-row creation is offered
```
