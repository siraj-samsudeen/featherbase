## Context

The existing explicit rename operation preserves values. Definition replacement instead diffs by name. Its destructive ambiguity is awaiting the owner ruling on #566. Unique constraint creation currently exposes a raw database error; Reference targets are not checked.

## Decisions

- Keep validation in the platform Table engine and exercise the public HTTP seam.
- Check repeated values inside the schema transaction, holding a table lock before checking and changing the unique constraint so concurrent inserts cannot bypass validation.
- Validate Reference targets at the public definition boundary; bootstrap and app installs can declare mutually dependent tables as a batch. Self references are valid.
- No inference of a rename from a drop/add diff without an owner ruling.

## Risks

Fresh migrations bootstrap definitions in dependency order that may include forward references. Public authoring must reject missing targets without breaking trusted batch installs. Explicit omitted-column semantics require owner approval before changing the pinned test.
