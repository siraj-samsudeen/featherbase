## Decisions

- **Names travel with the payload, not through the generic name lookup.** The server attaches the actor's display name to what the viewer already reads (the access page, a row's history). `POST /api/people/names` stays read as the viewer, because it also serves ordinary Person links, which this change does not open up.
- **Service account display name is a new column.** The short name (`label`) is a slug other code finds the account by (`svc-master-sync`), so it is never renamed for display.
- **The given display name shows only to those who may read Service Account** through the generic lookup, row and column rules applied; anyone else reads "Automation (<label>)", no more than the label that lookup already returned.
- **Apps name only their own actors.** `ctx.people.actorNames` resolves an id only when it created or last changed one of the app's rows, or made, changed or decided one of its change proposals.
