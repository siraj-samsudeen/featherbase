# AGENTS.md

Read this first. Then read `TESTING.md` before writing any test, and `BIG-PICTURE.md` before any design
choice.

Featherbase is an app builder on a database. This branch rebuilds it from scratch, one small build at a
time. Nothing outside this repository depends on it yet, so when something is wrong, change it outright.

## The map

```
features/
  importing-data/        a feature: something a person would name and show in a demo
    uploading/           a step of that feature
    proposing/
    confirming/
  managing-data/
    browsing/
    changing/
  foundations/           what every feature relies on
    home/  pages/  ui-preferences/  refusing/  api/  mcp/  database/
journeys/                the demos; they cross features
samples/                 sample files several features use
background/              a review of the old system; history, not instructions
```

**Each lowest folder is self-contained.** It holds:

- `<name>.md`: its sentences (what it must do) and what was decided about it;
- `<name>.test.ts`: one test per sentence;
- its code: the work itself, its API routes and its pages. A page and an API call are two doors onto the same
  code;
- its mock-up, if it has one of its own.

**There is no `src`, `specs`, `design`, `tests`, `docs` or `lib` folder, and there must not be one.** You were
trained on repositories that have them, and you will feel a pull to create them. Don't. A file belongs in the
folder of the feature, step or foundation it is about. A check fails when a file sits outside this map.

## Where a new thing goes

1. Is it part of something a person would show in a demo? It is a **step** of that feature, or a new
   **feature**.
2. Does every feature rely on it, and does it have behaviour worth a sentence? It is a **foundation**.
3. Neither? It is code inside the folder that uses it.

## Names

- A folder is named exactly as its heading in the sentences is named. Renaming one renames the other in the
  same change.
- A feature is named as an action on something, in two or three words: `importing-data`, `managing-data`.
- No abbreviations and no developer synonyms. If the sentences say "proposing", the folder is `proposing`,
  not `proposal` or `inference`.
- One part uses another only through what it deliberately offers, never by reaching into its files.

## Words

| Word | Meaning |
|---|---|
| Table | A set of rows with named Columns, such as Employees |
| Row | One entry in a Table |
| Column | One named, typed value every row has |
| Key | The Column, chosen by a person, that tells rows apart, such as Employee Code |
| Choice | A Column whose value comes from a short list |
| Upload | A file a person gave Featherbase, kept exactly |
| Raw row | One row of an upload, kept as it was |

## How to write

Sentences, decisions and messages to the owner are in plain everyday language, short. Write them the way you
would summarise the work in chat, not the way a specification is usually written. No Given/When/Then.

## How the work goes

- One build at a time, as a pull request into `featherbase-redesign`. The owner merges.
- For each sentence: write its test, see it fail, then write the code. Commit the test before the code.
- A small design question that comes up while building is settled with the owner. Write the answer under
  "Decided" in that folder's `.md`, in the same pull request.
- Anything that is a contract with the warehouse, or that touches every Table, goes back to the owner's
  planning session. Featherbase's own columns and what delete means are examples.
- Done means the journeys pass on a fresh install, with their recordings. It does not mean you say so.

## The stack

Bun, ElysiaJS, Postgres 18.6, Drizzle, `bun test` with `feather-testing-elysia`. Pages are HTML rendered by
the server, with htmx; React only where a screen really requires it, decided and recorded each time. One
package at the root. The reasons are in `features/foundations/database/database.md` and
`features/foundations/pages/pages.md`.

## Where to start

`journeys/1-featherbase-opens.md`.
