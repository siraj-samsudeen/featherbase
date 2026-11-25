# Feather Ask UI (#1377, Phase 1): hand-over

**Last updated:** 24-Nov-2026. A working note for moving between machines. It is removed
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
- New platform icon `bot` (lucide `Bot`) for the app (changed from `message_question` on 23-Nov-2026, Mohammad).
- No word rules on the server: the placeholder answers every question. The reply type keeps
  `kind: 'cannot'` so the page has a "can't answer" state for the model (Phase 2). The server
  refuses an empty question and one over 2000 characters.
- Source layout: `src/server/` (runs on the server; `index.ts` is the entry), `src/shared/`
  (types both sides use), `src/client/` (the page). Client: `main.tsx` renders `App`,
  `App.tsx` renders `components/HomePage.tsx`, which places `components/Sidebar.tsx` then
  `components/Chat.tsx` (Chat must come right after the sidebar: the platform styles that
  element as the page panel). `api.ts` will sit at `src/client/api.ts`.
- No verifier and no PR until the UI is complete (Mohammad, 24-Nov-2026): Step 2 is built on
  this branch before the PR.
- Ask stays at version 0.1.0 until its first release on `main`: it is installed nowhere else,
  so a manifest change needs no migration; recreate the local `fb_ask_ui` database instead
  (Mohammad, 24-Nov-2026).

## Done

1. Manifest and package files (`example-apps/ask/`), and the app icon (now `bot`, Lucide's Bot).
2. The server's `ask` read, `src/server/index.ts` and `src/server/reply.ts` (placeholder).
3. 3a: Featherbase runs locally with Ask installed; the read answers over HTTP (200), refuses
   an empty question (417) and a signed-out caller (401).
4. 3b: `App.tsx`, `HomePage.tsx`, `Sidebar.tsx`, `Chat.tsx`, `style.css`, and `main.tsx` imports
   the styles and follows the top bar's theme. Checked headless: Ask highlighted in the sidebar,
   white panel on the grey canvas, Collapse leaves the icon, dark and back, the app switcher
   returns to Featherbase, no console errors.
5. 3c: the empty page. `components/EmptyChat.tsx` (heading "What do you want to know?", three
   example questions), `components/QuestionBox.tsx` (Ask disabled until text, Enter sends,
   Shift+Enter is a new line, 2000-character limit from `shared/reply.ts`), and `Chat.tsx`
   sends both through one `ask()`, empty until 3d. `style.css` adds `@source` lines for Shop
   Floor's source, without which `Button` and `inputClasses` draw unstyled. 14 checks pass
   headless.
6. 3d: `src/client/api.ts` (POST the question with the version header; a 401 goes to the login
   page) and `components/QuestionAnswer.tsx` (type `AnswerStatus`: thinking, answered, failed;
   component `QuestionAnswer`). `Chat.tsx` shows each question with its answer once a question
   is asked, keeps the newest in view and passes `busy` to `QuestionBox`, which sends nothing
   while an answer is on its way. The server's read returns `{ answer }`, like Tickets'.
   17 checks pass headless.
7. 3e: a failed question shows Shop Floor's red `Notice` with **Try again** (the platform's
   word, as in `DataList`). Try again asks the same question again in the same place
   (`Chat.tsx`: `fetchAnswer`, shared by `ask` and `retry`) and waits, like the box, while
   another answer is on its way. 24 checks pass headless.
8. Piece 4: `apps/server/test/ask-app.test.ts` (installs Ask; anyone signed in gets the
   placeholder; empty, over 2000 characters and signed out are refused), Ask in
   `tools/prepare-apps.mjs`, and a README section "Explicit opt-in: Feather Ask". The tests
   use their own `featherbase_test` database; create it once on a new machine.
9. 2a: each question is saved with its answer. New Table `ask.question` (chat, question,
   answer, answer kind); `ask` is now an action (`/api/app_actions/ask/ask`, with an
   `idempotencyKey`), which starts a chat titled by the first question (one line, 140
   characters) or joins the one the page names, in one transaction. Own rows only: nobody
   reads or adds to someone else's chat. 6 server checks, 24 page checks and 7 save checks pass.
10. 2b: the sidebar has **New chat** (`/ask/`) and **My Questions** (`/ask/?view=questions`),
    as react-router 8.5.0 `Link`s (Mohammad chose links over buttons): no reload, Back and
    Forward step between them, Ctrl+click opens a new tab. `App.tsx` wraps the app in
    `BrowserRouter basename="/ask"`; `HomePage.tsx` reads `?view=` with `useSearchParams` and
    gives `Chat` the visit's `location.key`, so New chat clears an open chat.
    `components/MyQuestions.tsx` is the page's heading until 2c. The router writes `/ask`
    without the slash; the platform redirects it to `/ask/` on a reload. 13 sidebar checks
    and the 24 page checks pass.

Learned on the way: in local development the platform's sidebar shows its raw rows for about
half a second when switching apps (Tickets too), because `bar.js` loads as many modules; a
production build (staging) doesn't show it. PowerShell may block `npm.ps1`; use `npm.cmd`.

## Next step

**2c.** My Questions lists the person's own chats, newest first.

## Then

- 2d: opening a chat shows its questions and answers, and asking carries on in it.
- Step 3 (the panel on every page).
- Then the independent headless verifier at desktop width (its checklist includes: "Every
  record shown (person, store, section, department, ticket, and so on) is a link that opens
  it, or plain text only where the viewer may not open it."), remove this note, open the PR.
