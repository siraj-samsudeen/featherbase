## Context

Reflect proposes each Table's name as `<schema> <table words>`; the reflect action takes only a prefix. Column labels are `prettifyLabel(<source column>)`. `rowTitles` reads titles with SQL against the platform database, where a source-bound Table's rows are not, so it finds none and callers fall back to the id.

## Decisions

### The user names tables on the Browse screen; reflect takes a name per table

The Browse screen shows each connectable table's proposed name in an editable box; the reflect action takes `names: { <source table>: <Table name> }`, and a table without an entry keeps the proposal.

Rejected:
- **API only, no box** — what the user does can't be seen or tested in the browser, and #796 would have to add the box later anyway.
- **Rename after connecting** — renaming a Table no app owns isn't possible today (#777), and deleting and reconnecting deletes everything pointing at it.

### Titles of a source-bound Table are read through its scoped list

`rowTitles` reads a source-bound Table's titles with the same scoped list call its list view uses (`boundGetList`): the caller's permissions, Data Scope and column tiers apply exactly as there. A source that refuses or is down leaves those rows out, as an unreadable Table already does.

Rejected:
- **A separate SQL path per driver** — duplicates permission and scope handling the list read already does.
- **Caching titles locally** — breaks "read from the data source at that moment" and the no-local-copy promise.

## Risks / Trade-offs

- One list call per source-bound Table per request, up to 100 rows -> the same call the list view makes; requests are batched per Table.
- A name a user types may clash with an existing Table -> reflect already refuses a clash with a conflict error, shown on the Browse screen.
