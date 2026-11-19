# Help

What Featherbase answers questions about how things work from. Ask "how is
achievement worked out?" or "why can't I see Parkside?" and the answer comes
from passages here, with the files it used named under it.

- Pages in this folder are written for the people who use the apps: store
  managers, team leaders and section staff. Write one page per topic, in plain
  words, with a heading per question someone would ask.
- `sources.json` lists what else is searched, relative to this folder: the
  Feather Dash README, the specs (`openspec/specs/`) and the docs (`docs/`).
  Those stay where they are; add a path here to have it searched too.
- Only Markdown (`.md`) files are read. Each is split at its headings, and each
  part is searched on its own, so a short section under a clear heading is
  found more easily than a long one.

The platform reads this folder again before each question and embeds only the
passages that are new or changed. Set `HELP_SOURCES` to use another list.
The embedding model runs inside the server (`EMBEDDING_PROVIDER`), so no page
is sent anywhere to be embedded.
