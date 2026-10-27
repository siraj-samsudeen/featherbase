## Context

The existing explicit rename operation preserves values. Definition replacement instead diffs by name. Its destructive ambiguity is awaiting the owner ruling on #566. Unique constraint creation currently exposes a raw database error; Reference targets are not checked.

## Decisions

- Keep validation in the platform Table engine and exercise the public HTTP seam.
- Check repeated values inside the schema transaction, holding a table lock before checking and changing the unique constraint so concurrent inserts cannot bypass validation.
- Validate Reference targets in the shared definition validator used by create and update. Self references are valid. Fresh migrations are verified through the same validator. App installs pass their declared Table names so mutually linked definitions retain their existing declaration-order independence; arbitrary missing targets are still refused.
- No inference of a rename from a drop/add diff without an owner ruling.

## Risks

Fresh migrations and app installs must remain valid under target checks. A link to the Table currently being created is accepted without requiring it to be persisted first. Explicit omitted-column semantics require owner approval before changing the pinned test.
