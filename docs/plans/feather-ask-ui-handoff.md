# Feather Ask UI (#1377, Phase 1): hand-over

**Last updated:** 25-Nov-2026. A working note for moving between machines and sessions. It is
removed (or folded into the PR body) before the PR is opened.

On a new machine: pull this branch, follow **Set up**, then tell Claude Code:
"Read `docs/plans/feather-ask-ui-handoff.md` and continue from Next step."

On this machine, in a new session: open the worktree
`C:\Users\DELL\Documents\work\featherbase-1377-ask-ui` and say the same. The dev setup below
is already done there (database `fb_ask_ui`, Ask and Tickets installed, `.env.local`).

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
- **No PR and no push, of anything, until Mohammad says so** (25-Nov-2026): commit locally
  on `issue-1377-ask-ui` only. Don't start or propose sessions whose process would push.
- After drafting and checking a step, take the draft back out and give the walkthrough; when
  Mohammad says "make this change" (or "commit it"), Claude puts it in or commits instead.
- Mohammad likes the ChatGPT, Claude and Gemini way of doing things; check a layout against
  them, and prefer the simplest code that does the job.
- Before checking, make sure the dev server is up (`curl http://localhost:8077/api/ping`).
  When run from a Claude session it can stop with the session; an orphaned web half then
  holds port 5177 (`Port 5177 is already in use`): stop that process, then
  `pnpm featherbase start` again.
- Headless check scripts from earlier steps are kept outside the repo in
  `C:\Users\DELL\Documents\work\ask-handover\checks\` (run with `node <file>`; they sign in
  as Administrator). Some test behaviour later steps changed on purpose (for example
  `check2c-recent.cjs` expects chats to open their Featherbase record, which 2d changes).
- The server tests use their own database `featherbase_test` (already created here):
  `pnpm --filter server test test/ask-app.test.ts`.

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
- The list of a person's chats is **Recent Chats** (`/ask/?view=chats`), not #1377's "My
  Questions": it lists whole chats, and ChatGPT, Claude and Gemini use that wording
  (Mohammad, 25-Nov-2026). Tell Siraj, since #1377 names it My Questions.

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
10. 2b: the sidebar has **New chat** (`/ask/`) and **Recent Chats** (`/ask/?view=chats`),
    as react-router 8.5.0 `Link`s (Mohammad chose links over buttons): no reload, Back and
    Forward step between them, Ctrl+click opens a new tab. `App.tsx` wraps the app in
    `BrowserRouter basename="/ask"`; `HomePage.tsx` reads `?view=` with `useSearchParams` and
    gives `Chat` the visit's `location.key`, so New chat clears an open chat.
    `components/RecentChats.tsx` is the page's heading until 2c. The router writes `/ask`
    without the slash; the platform redirects it to `/ask/` on a reload. 13 sidebar checks
    and the 24 page checks pass.
11. 2c: the Recent Chats page lists the person's own chats, newest first: `myChats()` in
    `api.ts` reads the platform's list (`GET /api/table/ask.chat`; own rows only, so an
    administrator sees everyone's), and `RecentChats.tsx` draws it with Shop Floor's
    `DataList` (loading, error with Try again, "No chats yet"). Each chat is a `RecordLink`,
    opening its Featherbase record until 2d; Started says how long ago. 10 list checks pass.
12. 2c-2: Recent Chats loads 50 at a time; **Load older conversations** adds the next 50
    (`myChats(skip, count)` sends `limit_start` and `limit_page_length` and returns the
    `total`) and goes when every chat shows. A chat shown twice after a new one is dropped.
    12 checks pass; with 150 test chats it runs 50, 100, 150.
13. 2c-3: the chats in the sidebar, as ChatGPT's (Mohammad's design, 25-Nov-2026). Under
    New chat, the heading row "Recent Chats … ↗ ⌄": the words and ⌄ open and close the list,
    ↗ ("See all chats") opens the Recent Chats page. Then the newest 20 chats as plain
    one-line rows, no icons, a long title cut with "…", how long ago on the right (now, 5m,
    3h, 2d), then Load older conversations (20 more). A new chat appears at the top as its
    first answer arrives (`Chat`'s `onNewChat`, `HomePage`'s `saved`). On the Recent Chats
    page the list is left out. Collapsed to icons: only New chat and one Recent Chats icon
    that opens the page (no list, no menu). Shop Floor's icons gain `ArrowUpRight`.
    The plain clock below in the rail is the platform's Recently Opened, shown only to
    people who can use the Admin (#1385). 18 list, 7 rail and 10 heading checks pass.

Learned on the way: in local development the platform's sidebar shows its raw rows for about
half a second when switching apps (Tickets too), because `bar.js` loads as many modules; a
production build (staging) doesn't show it. PowerShell may block `npm.ps1`; use `npm.cmd`.
The platform's rule that hides `data-depth="1"` rows in the collapsed rail sits in the page's
stylesheet, so the sidebar's own `display:flex !important` wins and such rows still show
(Tickets' Types group too); Ask no longer uses that pattern. Worth an issue for #1385.

## Next step

**2d, in progress: Mohammad is typing it.** Opening a chat, from the sidebar or the Recent
Chats page, shows its questions and answers in Ask (`/ask/?chat=14`), with no reload, and
asking carries on in it. The open chat is highlighted in the sidebar; a missing or someone
else's chat shows "This chat could not be found…" with Try again and Start a new chat.

- Claude's checked draft (14 checks passed, `check2d.cjs`) is in
  `C:\Users\DELL\Documents\work\ask-handover\2d-draft\` (`2d.diff` is the whole change).
- Seven files, typed in this order: the address helper (`chatPath`), `App.tsx`
  (`RecordPagesProvider`: an `ask.chat` record opens at `/ask/?chat=<id>`), `api.ts`
  (`openChat()`), `HomePage.tsx` (reads `?chat=`), `Chat.tsx` (`opened`: loads the chat,
  "Opening the chat…", the not-found box), `Sidebar.tsx` (rows open in place via
  `navigate`, the open chat highlighted), `RecentChats.tsx` (a `ChatLink` with `onNavigate`).
- Where Mohammad was when this note was written (not committed): `App.tsx`, `api.ts` and
  `HomePage.tsx` changed; the address helper is his `src/client/route.ts` (the draft calls it
  `pages.ts`, same content). Still to do: `Chat.tsx`, `Sidebar.tsx`, `RecentChats.tsx`, and
  import `chatPath` from `./route` / `../route`. Until those are done the build fails.
- Then: build, run `check2d.cjs` and the manual checks, compare with the draft, commit.
- Not in 2d, for later: a chat added to does not move to the top (the list is ordered by
  when a chat started; ChatGPT orders by last use, which needs a "last asked" time on the
  chat); a brand-new chat's address stays `/ask/` after its first answer.

## Then

- 2e: a "⋯" menu on each chat with Rename and Delete (asks first; deletes the chat and its
  questions together). A manifest change: recreate the local database.
- Later: group the lists by Today, Yesterday, Previous 7 days, Previous 30 days.
- Step 3 (the panel on every page).
- Then the independent headless verifier at desktop width (its checklist includes: "Every
  record shown (person, store, section, department, ticket, and so on) is a link that opens
  it, or plain text only where the viewer may not open it."), remove this note, open the PR.
