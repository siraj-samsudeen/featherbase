## ADDED Requirements

### Requirement: The list says when it can't remember its arrangement

When a change to the list's sort or columns can't be remembered, the list
SHALL tell the user straight away. The change still applies on screen, but
the list will open the old way next time.

#### Scenario: Sorting while the server can't save

- **WHEN** the user sorts the list and the server fails to save it
- **THEN** the list is sorted, and a message says the sort won't be kept for next time
