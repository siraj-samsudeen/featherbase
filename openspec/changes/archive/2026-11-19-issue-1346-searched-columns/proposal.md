## Why

Search matches only a row's key and its title. A warehouse login such as "asha_reports", or an employee code, names a record but is neither, so typing it finds nothing (#1346, #1341).

## What Changes

- A Table can name more of its columns that search matches. The row still shows its title.
- A searched column the viewer may not read never matches for them, and a stored secret can never be listed.

## Capabilities

### New Capabilities

### Modified Capabilities

- `search-and-explore`: a Table can name more columns that search matches.
