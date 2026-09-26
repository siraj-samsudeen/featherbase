# Design

## Context

See `proposal.md` for the user-facing problem. Lists, row counts and direct row
opening already apply own-row and Data Scope limits from one server-owned
permission path. Global row search checks only whether the person can read the
table, then searches all rows in it.

A row shared directly with a person can be opened from a known link, but the
ordinary list/search scope does not currently add shared rows. That discovery
behavior remains unchanged. A table may also use a sensitive field as its
search result title; this change closes that title leak together with the row
scope leak.

## Goals / Non-Goals

**Goals:**

- Make every row returned by global search pass the same own-row and Data Scope
  limits as list and count operations.
- Match and display a configured title only when the person can read that
  field, otherwise allowing ID matches with an ID fallback.
- Preserve existing search matching, caps, response shape and connected-table
  exclusion.
- Prove the boundary through the server API and through the visible search
  experience as a restricted user.

**Non-Goals:**

- Changing which tables appear in search.
- Changing result ranking, caps, matching syntax or the search interface.
- Changing list, count, form or direct-row permission behavior.
- Adding directly shared rows to lists, counts or search.
- Fixing the separate permission leaks tracked in issues #338 and #340–#342.

## Decisions

### Reuse the existing row-visibility decision

Global search will ask the query module for the same permission-scoped row
selection already used by lists and counts, then add its existing row-ID/title
match inside that selection. It will not rebuild own-row or Data Scope rules in
the search module.

This keeps one source of truth as new permission rules are added. Calling the
ordinary list operation twice—once for row IDs and once for titles—was rejected
because it changes per-table caps and ordering and requires deduplication.
Adding a general-purpose OR operator to public list filters was rejected as a
much broader API change.

The text-match alternatives must stay grouped together before they are combined
with the permission boundary. Otherwise a title match could bypass the row
limit even while an ID match is protected.

### Preserve unreadable-table behavior

Global search will continue to skip a table the person cannot read rather than
failing the complete cross-table search. Connected outside databases remain
excluded before row search begins.

### Do not widen discovery for directly shared rows

A directly shared row remains openable from its known link, but this change does
not make it discoverable through global search when the person lacks ordinary
row access.

This keeps #339 a leak-closing change and matches current list behavior. Shared
discovery can be designed later across lists, counts and search together rather
than making those read surfaces disagree.

### Use readable fields to choose search title behavior

The same query plan that supplies the row boundary also supplies the fields the
person may read. Search will include the configured title in matching and output
only when that readable-field set contains it. Otherwise it will match only the
row ID and return that ID as both identifier and display title.

This avoids a second interpretation of sensitive-field permissions in the
search module and preserves the existing response shape without a blank or
masked title.

## Risks / Trade-offs

- **A future search path bypasses the shared row-visibility decision** → Keep
  permission-focused tests at the global-search API boundary, not only on the
  internal helper.
- **Boolean grouping protects ID matches but not title matches** → Use one
  asymmetric regression case where the allowed row matches by ID and the
  forbidden row matches only by title.
- **A sensitive title is removed from output but still participates in
  matching** → Test a term found only in the hidden title, a row-ID match with
  ID fallback, and the same title search by an authorized caller.
- **Per-table permission checks add work to typeahead search** → Reuse the calls
  lists already make and preserve current result caps; do not add extra row
  round trips.

## Migration Plan

No data or API migration is needed. Deploy the server change with its tests;
rollback restores the previous search behavior without changing stored data.
