## Decisions

### A search box beside the native picker

A text box before "Start from" narrows the native `<select>`'s options; Enter picks the first match; the table already chosen stays listed while a search hides it.

Rejected:
- **A custom combobox replacing the select** — more code, and it gives up the native picker's keyboard and screen-reader behaviour, which the existing Explore tests rely on.

### The title loader sends batches of 100

Titles asked for in the same moment are still sent together, now in batches of at most 100 rows, the server's limit per request.

Rejected:
- **Raise the server's limit** — the limit bounds the cost of one request; a full pane is the only caller that exceeds it.
