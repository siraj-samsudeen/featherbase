# Feather Ask UI (#1377, Phase 1): hand-over

**Last updated:** 23-Nov-2026. A working note for moving between machines. It is removed
(or folded into the PR body) before the Step 1 PR is opened.

On a new machine: pull this branch, follow **Set up**, then tell Claude Code:
"Read `docs/plans/feather-ask-ui-handoff.md` and continue from Next step."

## Set up on a new machine

Needs Node 26, pnpm (corepack), Git, the GitHub CLI and PostgreSQL (README § Getting started).

```powershell
git clone https://github.com/siraj-samsudeen/featherbase.git C:\work\featherbase
cd C:\work\featherbase
git switch issue-1377-ask-ui
pnpm install
pnpm apps:prepare
npm install --prefix example-apps/ask
```

Create `.env.local` in the repo root (gitignored). Use that machine's Postgres password and
the folder the repo is in:

```
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fb_ask_ui
API_PORT=8077
WEB_PORT=5177
FEATHERBASE_APP_PATHS=["C:/work/featherbase/example-apps/ask"]
```

Then build Ask, prepare the database, install Ask and start:

```powershell
npm run build --prefix example-apps/ask
pnpm featherbase setup
pnpm featherbase advanced apps install-app ask    # prints: installed ask
pnpm featherbase start
```

Sign in at http://localhost:5177/featherbase/login as `Administrator` / `admin` (development
only) and open http://localhost:5177/ask/. After each change to Ask, `npm run build` in
`example-apps/ask`; the running server picks up the new build without a restart.

## How we work (Claude, follow this)

- The intern (Mohammad) writes the code; this is their evaluation project. Claude explains,
  reviews what was written, runs the checks and verifies. Claude does not write the feature
  into the repo for them.
- For each piece, in this order: (1) an overview of the files to write (one line each) and the
  pages the person will see; (2) what the piece is for; (3) a walkthrough of how the existing
  code does it, with file:line links (usually Tickets: `example-apps/tickets`); (4) the code,
  in full; (5) manual checks, each with the expected result.
- Go step by step: each step ends with a manual check in the browser, then a commit.
- Run every check yourself first (HTTP or headless browser) before handing it over. Nothing is
  done on anyone's word.
- Ask design questions one at a time, with options and a recommendation.
- PRs are drafts until CI is green. Feather Ask goes through PRs, not pushes to `main`.

## Decisions so far

- Ask is open to everyone signed in: `ask.chat` is its entry Table, `role: All`, `can_read`,
  `own_rows_only` (each person sees only their own chats, ready for Step 2).
- New platform icon `message_question` (lucide `MessageCircleQuestion`) for the app.
- No word rules on the server: the placeholder answers every question. The reply type keeps
  `kind: 'cannot'` so the page has a "can't answer" state for the model (Phase 2). The server
  refuses an empty question and one over 2000 characters.
- Source layout: `src/server/` (runs on the server; `index.ts` is the entry), `src/shared/`
  (types both sides use), `src/client/` (the page). Client: `main.tsx` renders `App`,
  `App.tsx` renders `components/HomePage.tsx`, which places `components/Sidebar.tsx` then
  `components/Chat.tsx` (Chat must come right after the sidebar: the platform styles that
  element as the page panel). `api.ts` will sit at `src/client/api.ts`.

## Done

1. Manifest and package files (`example-apps/ask/`), and the `message_question` icon.
2. The server's `ask` read, `src/server/index.ts` and `src/server/reply.ts` (placeholder).
3. 3a: Featherbase runs locally with Ask installed; the read answers over HTTP (200), refuses
   an empty question (417) and a signed-out caller (401).
4. 3b, mostly: `App.tsx`, `HomePage.tsx`, `Sidebar.tsx`, `Chat.tsx`, `style.css` are written.

## Next step

**Finish 3b.** `src/client/main.tsx` still renders `App` without `import './style.css'` and
without following the top bar's theme, so the page has no styles and dark mode does nothing
(measured: `--color-canvas` empty, body transparent, no CSS file in `dist/client/assets`). It
should read:

```tsx
/// <reference types="vite/client" />
// The page's entry: paints the theme the shared top bar chose, then draws the app.
import { createRoot } from 'react-dom/client'
import { THEME_CHANGE_EVENT, paintTheme } from '@featherbase/shop-floor/theme'
import { App } from './App'
import './style.css'

// The top bar tells the page which theme it painted: on <html> once, and with an event on each change.
const painted = document.documentElement.getAttribute('data-featherbase-theme')
paintTheme(painted === 'light' || painted === 'dark' ? painted : 'device')
window.addEventListener(THEME_CHANGE_EVENT, (event) => {
  const theme = (event as CustomEvent<{ theme: 'light' | 'dark' }>).detail?.theme
  if (theme === 'light' || theme === 'dark') paintTheme(theme)
})

createRoot(document.getElementById('root')!).render(<App />)
```

3b checks at `/ask/`: the sidebar with **Ask** highlighted (and the platform's search and the
person's name); a white panel beside it on the grey canvas; Collapse leaves the icon; the top
bar's theme switch turns the page dark and back; the app switcher returns to the frame; no
console errors.

## Then

- **3c:** the empty page in `Chat.tsx`: heading "What do you want to know?", three example
  questions (clicking one asks it), and the question box (Ask disabled until text; Enter
  sends, Shift+Enter is a new line).
- **3d:** `src/client/api.ts` (POST `/api/app_reads/ask/ask` with `{ payload: { question } }`,
  header `X-Featherbase-App-Version: ask@<version>`, 401 goes to the login page) and the
  turns: the question, "Thinking…", the answer. The scroll-into-view effect must use braces
  so it returns nothing: `scrollIntoView` returns a Promise in Chromium and React would call
  it as a cleanup (this crashed the page in a trial).
- **3e:** the error state with Retry.
- **Piece 4:** `apps/server/test/ask-app.test.ts` (install Ask, call the read over HTTP:
  answer, empty refused, too long refused, signed out refused), add Ask to
  `tools/prepare-apps.mjs`, a README section like Tickets'.
- Then the independent headless verifier at desktop width against the Step 1 checklist
  (it includes: "Every record shown (person, store, section, department, ticket, and so on)
  is a link that opens it, or plain text only where the viewer may not open it."), then the
  draft PR.
- Step 2 (Chats) and Step 3 (panel on every page) follow, each its own PR.
