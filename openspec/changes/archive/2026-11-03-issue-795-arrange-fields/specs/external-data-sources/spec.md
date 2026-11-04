# External Data Sources

## ADDED Requirements

### Requirement: A text column with a declared length is one-line text

Connecting a table SHALL make a text column with a declared length one-line
text, however long its limit. Only text with no limit is long text.

#### Scenario: The parcel's sender reads on one line

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel
Then the user sees its sender on one line
And the user sees its instructions as long text
```
