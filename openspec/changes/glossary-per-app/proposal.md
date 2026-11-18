## Why

The glossary is for the people who use an app's words, but its only page sits inside the Admin, which a Dash-only Store Manager or Team Leader cannot open. They are allowed to read it and have no way in. The owner decided (18-Nov-2026) that every app has its own glossary, readable by anyone who can use that app, with the instance's own terms shared by all of them.

## What Changes

- Each app has its own glossary page: the app's terms, then the instance's own terms. Anyone who can use the app reads it and searches it; nobody reads the glossary of an app they cannot use.
- The way in is the Help menu of the app's sidebar, beside Keyboard shortcuts. The Admin's glossary page and its sidebar link are removed; the app's page is the only glossary page.
- An app's glossary is the whole instance plus the app. A word that both have is shown twice, each marked with where it comes from (the app, or shared across apps); nothing is refused or hidden because of a repeated word.
- Out of this change, decided with the owner and still to come: how a word's meaning shows on an app's own pages (Dash), and Dash's own terms, whose wording the owner approves first.

## Capabilities

### Modified Capabilities

- `glossary`: reading is per app; the instance's own terms show in every app's glossary; a repeated word shows where each meaning comes from; the Help menu opens it.

## Impact

- `apps/server/src/glossary.ts`, `controllers/glossary-term.ts`, `runtime-packages.ts`, `index.ts` (the glossary read takes the app; naming rules).
- `apps/web`: a glossary page per app, the Help menu entry, the Admin page and link removed.
- No data migration: terms are stored as they were.
