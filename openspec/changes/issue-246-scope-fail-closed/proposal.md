## Why

Store managers will edit their own store's section and subcategory rows at go-live. Today a person whose Data Scope (the rows that narrow what they see) failed to sync has no narrowing at all, so they see and can change every store's rows. And any reference to a narrowed table narrows a row, even one that only mentions a store in passing, such as a supplier store (#246).

## What Changes

- A Table can name the reference columns its Data Scope narrows by. Other reference columns no longer narrow it. A Table that names none behaves as before.
- A Table can require scope. A person with no Data Scope on its named columns then sees none of its rows and can neither open nor write any. A row that names no value there is open only to administrators.
- Administrators are unaffected.
- Lists, counts, search, row reads, every write, realtime updates and source-bound Tables all apply both rules.

## Capabilities

### Modified Capabilities

- `permissions-and-roles`: which references narrow a Table, and a Table that stays closed to people with no narrowing.

## Impact

- Migration `0154` adds the two settings to every Table definition, off by default, so no existing Table changes behaviour.
- Deriving Data Scope from an app's own tables (item 3 of #246) is not part of this change.
