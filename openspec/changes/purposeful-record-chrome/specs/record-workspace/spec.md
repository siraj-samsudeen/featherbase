# Record Workspace

## ADDED Requirements

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
