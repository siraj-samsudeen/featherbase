## ADDED Requirements

### Requirement: A saved view keeps its view

Saving a view SHALL keep the list's view with its filters, and reopening the saved view SHALL show the list in that view, whatever the person last chose for the Table.

#### Scenario: A queue view opens as cards

```gherkin
Given the user saved "My Open Requests" while reading the list as List And Record
And has since switched that Table to Table
When the user opens "My Open Requests"
Then the list shows as List And Record with the view's filters
```
