# Review: a glossary for each app

What changed, and how to check it yourself. Everything here was run on a local
instance (`pnpm dev jeyarama/dash --made-up-data`, a fresh database) in a headless
browser; the screenshots are in this folder. The run is repeatable: the
step-by-step results are in `results.json`.

## What the change does

- Each app has its **own glossary page**, `/featherbase/glossary/<app>`. It lists that app's
  own terms, then the words every app here shares (the instance's terms).
- A word defined both in the app and in the instance **shows twice**, once under each
  source (the app's name, and "Shared across apps"). Nothing is refused or hidden.
- The way in is the app's **Help menu** in the sidebar: Help → Glossary.
- **Who can read it:** a person who can use the app. Someone who cannot use it is told so
  plainly (no retry button). An Administrator can read any installed app's glossary.
- The **Admin's glossary page and its sidebar link are gone**. The per-app page is the only one.
- **Dash, Tasker and Tickets now ship their own terms**: Dash 28, Tasker 27, Tickets 18.
  Terms whose meaning the sources do not state were left out, and are listed as questions
  on the wording review page. All wording is a first draft, to be refined.
- Versions: Dash 0.13.37, Tasker 3.3.5, Tickets 0.2.22 (a changed app needs a higher
  version; each step changes no Table).

## Try it yourself

Start it: `pnpm dev jeyarama/dash --made-up-data` (the page prints the sign-in details).
The instance's own terms are entered by people, so a fresh database has none; add a
couple at the Admin (Glossary Term) to see them beside an app's terms, for example a
"Gap" to see a word shown under two sources.

| # | Do this | Expect |
|---|---|---|
| 1 | Sign in as `reader-sm@example.test`. On any Dash page, click the **?** (Help) at the foot of the sidebar | The menu lists **Keyboard Shortcuts** and **Glossary** |
| 2 | Click **Glossary** | Dash's glossary opens: heading "The words Dash uses, and the words every app here shares", with a **Dash** group of 28 terms |
| 3 | Look for "Gap", "Achieved", "A dash in a figure", "Dive" | Each is there, with a meaning and examples |
| 4 | Type `target` in **Search terms** | The list narrows to terms that mention it |
| 5 | Search `gap` (with an instance term "Gap" added) | **Gap** appears under **Dash** and again under **Shared across apps**; each shows its own meaning |
| 6 | Open `/featherbase/glossary/tasker` as this person (who cannot use Tasker) | "You cannot read this glossary, because you cannot use this app." No retry button |
| 7 | Switch the theme to dark and open the glossary | Readable, no clashing colours |
| 8 | Sign in as `Administrator` (see the start-up page). Open the Admin | **No Glossary link** in the sidebar, and **no Glossary** in the Admin's Help menu |
| 9 | As the Administrator open `/featherbase/glossary/tasker` and `/tickets` | Each lists its own terms plus the shared words. Tasker's own **Store** and the instance's **Store** show side by side, each under its source |
| 10 | Open `/featherbase/admin/glossary` | The old page is gone |

## What was run, with the screenshots

| Scenario | Result | Screenshot |
|---|---|---|
| S1 Help offers the glossary, and opens it | pass | `02-help-menu-glossary.png`, `03-dash-glossary.png` |
| S2 Dash terms plus the instance terms, all listed | pass | `03-dash-glossary.png` |
| S3 Search; a word in both sources shows twice | pass | `04-dash-search-target.png`, `04b-dash-gap-two-sources.png` |
| S4 An app the person cannot use is refused plainly; Tickets (open to all) is readable | pass | `05-reader-tasker-glossary.png`, `05-reader-tickets-glossary.png` |
| S5 The old Admin glossary page is gone | pass | (no page) |
| S6 Dark theme | pass | `06-dash-glossary-dark.png` |
| S7 The Admin has no Glossary link or Help item | pass | `07-admin-home.png`, `08-admin-help-menu.png` |
| S8 The Administrator reads every app's glossary | pass | `09-admin-*-glossary.png` |
| S9 Two Stores side by side with their sources | pass | `09-admin-tasker-glossary.png` |
| S10 An unknown app has no glossary | pass | (refused) |

## Something the run found, and fixed

An app the person cannot use first showed "The glossary could not be loaded" with a
Try again button, which never helps. It now says "You cannot read this glossary, because
you cannot use this app." (a test pins it).

## Checks run locally

- Server and web typechecks: clean.
- Tests: the glossary tests (server and web), the Tickets and Tasker tests, Dash's manifest test.
- `check:specs`, `check:scenarios`, `check:vocabulary`, `check:app-versions`,
  `check:platform-imports`: pass.
- The CI run on the pull request is the full check.

## Deliberately not handled

- A glossary term's wording is a first draft; the questions behind the left-out terms are on
  the wording review page (`docs/mockups/glossary-wording-review.html`).
- The (?) after a word on Dash's own pages (decision 3, option A) is a separate change.
- The instance's own terms are data entered by people, so they are not shipped in code.
