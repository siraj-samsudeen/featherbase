# Feather Ask UI (#1377, Phase 1): hand-over

**Last updated:** 27-Nov-2026 (backend 1a to 1d committed; ADR 0028, the caller's own credential; next: 1e). A working note for moving between machines and sessions. It is
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
- One small feature at a time (Mohammad, 26-Nov-2026): "we are adding X" in a paragraph, the
  code in full, a short note; a tiny diagram only where it is confusing; then the manual
  checks with expected results. No line-by-line walkthrough, no whole plan or full OpenSpec
  proposal in one go, and keep the token use low. Explain in plain words, as to someone new
  to Featherbase.
- Go step by step: each step ends with a manual check (browser or HTTP), then a commit.
- **Keep OpenSpec current** (Mohammad, 26-Nov-2026): the changes `feather-ask-ui` (the page,
  built) and `feather-ask-agent` (the backend) in `openspec/changes/` are the record for whoever
  picks this up. With each step's commit, tick its task in that change's `tasks.md`; a new
  decision goes into its `design.md` (with the rejected alternative), a new promise into its
  specs. Specs files commit on their own, never with code (`tasks.md` may go with either).
- 1c's code goes in its own file `apps/server/src/mcp-app-reads.ts`; `mcp.ts` only exports
  `buildServer`, `Refusal` and `Envelope` (Mohammad, 26-Nov-2026). Draft and its check results
  in `ask-handover\1c-draft\`.
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
- The committed server still answers every question with a placeholder (`src/server/reply.ts`);
  backend step 2 replaces it with the agent and its stand-in model. The reply type keeps
  `kind: 'cannot'` for a question the model can't answer. The server refuses an empty
  question and one over 2000 characters.
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
- The real model, for now: Gemini and Groq, with Mohammad's own keys, for personal testing
  while the rest of the backend is built. OpenRouter (no account yet) comes after, together
  with billing and choosing a model on the page (Mohammad, 26-Nov-2026). Not OpenCode Zen,
  which #1377 names: tell Siraj. Gemini, Groq and OpenRouter all take OpenAI-style chat
  calls, so one adapter set by address, key and model covers all three (Mohammad, 26-Nov-2026);
  moving to OpenRouter is a settings change. Keys go in the app's declared `secrets`
  (`ctx.secrets` in an action, as Dash's `featherbase.json`).
- Ask is an agent over every app the person can use, through the platform's MCP tools, not
  #1377's design (see Next step). A refused tool call is a result the model reads; at most 8
  steps a question, and if they run out after a refusal the person is told its reason
  (Mohammad, 26-Nov-2026; replaces "2 retries").
- While the agent works, the page keeps its one "Thinking…", no streamed steps (Mohammad,
  26-Nov-2026).
- **How Ask reaches the tools** (Mohammad, 26-Nov-2026, after research; ADR 0021 kept):
  in-process, no network: the same MCP tool server built in memory (`InMemoryTransport`),
  each tool's inner `/api` call made with `app.request` as `/mcp` does. Identity is a
  **5-minute access token** ("pass") the platform issues for the person, labelled
  `Feather Ask` (`issueAccessToken` in `auth.ts`), kept only in server memory, reused for
  that person's next questions and renewed when under 2 minutes remain; it expires on its
  own. Calls run under `runAsAgent` with the pass's id and label, as `/mcp`'s do, so history
  reads "via Feather Ask" and every app speaks its installed version. Only the read-only
  tools are offered or run. Add a sweep that deletes expired tokens (ADR 0027 asks for one;
  only per-connection clean-up exists, `agent-auth.ts:225`). Rejected: forwarding the browser
  session (breaks ADR 0021 and the MCP spec's "MUST NOT accept or transit any other tokens";
  no session in background runs), and an in-process identity without a token (a second,
  credential-free way into `/api`; would need an ADR superseding 0021). Sources: Saltzer &
  Schroeder 1975 (economy of mechanism, complete mediation), the MCP authorization spec,
  RFC 8693, NIST SP 800-207. Precedent: agent sign-in already mints 1-hour keys for people
  (`agent-auth.ts` `mintPair`).
- **Think first, save at the end** (Mohammad, 26-Nov-2026): a model call takes 5–30 s, so the
  agent must not run inside a database transaction (it would hold a connection and its
  locks). The agent runs in an **outbound read** (its handler runs after the transaction has
  closed, as Dash's MotherDuck reads); then a short action saves the chat, question and
  answer in one transaction. The page still shows one "Thinking…".
- **"Mcp" in every name of backend step 1** (Mohammad, 26-Nov-2026): "Featherbase" alone is
  too generic for platform code. The manifest flag is `"featherbaseMcp": true`, the helper
  `ctx.featherbaseMcp`, the types `FeatherbaseMcpTool`, `FeatherbaseMcpToolCallResult` and
  `FeatherbaseMcpTools`. The drafts in `ask-handover\` still use the old names
  (`featherbaseTools`, `ctx.featherbase`, `FeatherbaseTool…`).

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
14. 2d: opening a saved chat. A chat, from the sidebar or the Recent Chats page, opens in
    Ask at `/ask/?chat=14` with no reload and shows its questions and answers; asking
    carries on in it. `route.ts` (`chatPath`), `App.tsx` (`RecordPagesProvider`: an
    `ask.chat` record opens in Ask), `api.ts` (`openChat()`), `HomePage.tsx` (reads
    `?chat=`), `Chat.tsx` ("Opening the chat…", the not-found box with Try again and Start
    a new chat), `Sidebar.tsx` (rows open in place, the open chat highlighted),
    `RecentChats.tsx` (`ChatLink`, RecordLink's `onNavigate`). 14 checks pass
    (`check2d.cjs`).

Learned on the way: in local development the platform's sidebar shows its raw rows for about
half a second when switching apps (Tickets too), because `bar.js` loads as many modules; a
production build (staging) doesn't show it. PowerShell may block `npm.ps1`; use `npm.cmd`.
The platform's rule that hides `data-depth="1"` rows in the collapsed rail sits in the page's
stylesheet, so the sidebar's own `display:flex !important` wins and such rows still show
(Tickets' Types group too); Ask no longer uses that pattern. Worth an issue for #1385.

## Next step: the backend (Mohammad, 26-Nov-2026)

The frontend is paused after 2d. **Ask is an AI agent over every app the person can use**
(Mohammad, 26-Nov-2026). It does not follow #1377's Agreed design: #1377's own tools
(point 6), fixed retries (point 7), the admin's askable list (point 12) and prepared queries
for joins (point 13) are dropped. Tell Siraj.

How it works: the model gets the question and Featherbase's read-only MCP tools (7 today, in
`apps/server/src/mcp.ts` and `mcp-table-tools.ts`: `list_tables` lists every Table the
person can read, across all apps; `describe_table`, `query_rows`, `get_row`, `list_imports`,
`check_import`, `suggest_table`). It calls tools as often as it needs, as the person, then
writes the answer. A refusal is a tool result it reads; at most 8 steps a question. Ask never
lists tools of its own. See Decisions for how Ask reaches the tools and where the agent runs.

Steps, one small feature at a time. Featherbase's MCP first; other apps' own connections
later (Mohammad: everything but MotherDuck already goes through Featherbase):

1. **Featherbase's MCP tools for an app's outbound read** (start here). The platform hands a
   read that declares `"featherbaseMcp": true` (and `"outbound": true`) `ctx.featherbaseMcp`:
   `tools()` and `call(name, args)` → `{ ok: true, result } | { ok: false, reason }`.
   Built as in Decisions: the MCP tool server in memory, the 5-minute pass, `runAsAgent`,
   read-only tools only. Needed because an app's own `documents` can't read another app's
   Tables (`runtime-actions.ts` metaFor: "Actions cannot access another application's owned
   Tables"). Pieces: the shared types (`packages/shared/src/runtime-actions.ts`), the
   declaration flag (`packages/shared/src/app-access.ts`, `apps/server/src/app-access.ts`
   `operationSchema`), the helper in `mcp.ts` plus `serveFeatherbaseTools(app)` in `index.ts`,
   the pass cache, handing it to the outbound read's context in `runtime-actions.ts`
   (`executeRuntimeRead`), the expired-token sweep, and a server test
   `apps/server/test/featherbase-tools.test.ts` with a `tools` outbound read added to
   `test-apps/action-proof` (offered only the read-only tools; reads as the person, Selvi
   sees her row and Ravi none; `create_row` doesn't exist for it; a read without the flag
   isn't handed them; the pass is reused, renewed and expires). Mohammad has already added
   the `Client`, `InMemoryTransport` and type imports to `mcp.ts` (uncommitted; the type
   import becomes `import type { FeatherbaseMcpTool, FeatherbaseMcpTools } from 'shared'`).
   1a, the shared types (`FeatherbaseMcpTool`, `FeatherbaseMcpToolCallResult`,
   `FeatherbaseMcpTools`, and `featherbaseMcp?` on `RuntimeReadContext`, exported from
   `shared`'s `index.ts`): done (commit 87f4552ea, 26-Nov-2026; both
   typechecks pass). 1b, the flag (`featherbaseMcp?: true` on `AppOperationDeclaration`;
   in `operationSchema`'s table policy, refused without `outbound`, so actions refuse it
   too): done (commit b27055fbe, 26-Nov-2026; both typechecks pass, five manifest cases
   checked with `readDeclaration`/`actionDeclaration`). 1c, `featherbaseMcp(person, label)`
   and the pass in `mcp-app-reads.ts`: done (commit 4900bc34a; typecheck, six checks against
   `fb_ask_ui`, the 59 `/mcp` tests pass). 1d, `executeRuntimeRead` hands `ctx.featherbaseMcp`
   to an outbound read that declares the flag, closed when the handler ends; the pass is
   labelled by the app's title ("Ask", so history reads "via Ask"), else its name: done
   (commit 2db345742; `checks\check1d.mts`, 8 checks, fails without 1d; 38 existing tests).
   **The caller's own credential** (Mohammad, 27-Nov-2026, ADR 0028, replacing the pass and the
   planned sweep): the read passes down `authCredential(c)` from `app-routes.ts` to
   `featherbaseMcp`, which sends it as the Bearer header on every tool call inside `runAsAgent`.
   The existing front-door checks apply; no credential, no tools. (A "no token, person on the
   mark" version was drafted on 26 Nov as ADR 0028 and rewound before push; its draft is in
   `ask-handover\1e-draft\`, not to be used.) View as mixing two people in one answer is left
   for later (task 1f2). Next: draft 1e for forwarding. Progress is ticked in
   `openspec/changes/feather-ask-agent/tasks.md`.
   Permissions: propose an adversarial review in one line before it lands.
2. **The agent loop in Ask**, with the stand-in model: a `think` outbound read (declares
   `featherbaseMcp`) runs the loop; the `ask` action saves chat, question and answer; the
   page calls think, then ask, under one "Thinking…". Open question for then: the page sends
   the answer to save, so it could save a made-up answer in its own chat; sign it in think
   and check it in ask (the old prototype did, HMAC), or accept it (only the person's own
   chat).
3. **Gemini and Groq** through one OpenAI-style adapter, with tool calling (which models: ask then).
4. **Every app's own reads as MCP tools**, so Ask reaches all the instance's apps. An app marks
   a read for agents in its manifest with a description and an input schema (today a
   declared read has only a name and its policy); the platform publishes it as an MCP tool
   `<app>.<read>`, run through the app's read as the person, under its own policy. Opt-in,
   because many reads are page helpers (`embed_session`, `view_as_people`). First: Dash's
   `report` (sales versus target, from MotherDuck). Claude Code over /mcp gets them too.
5. **Sums and totals**: `query_rows` gives at most 100 rows a page and a count, so a figures
   question ("total sales") needs a read-only sum/group tool in the MCP. Decide when it's met.
6. **Limits, budget and the log**; OpenRouter, billing and choosing a model come with these.
7. Later: writes on request, with the person's confirmation (#1372); a scheduled Ask with
   nobody signed in would need its own agent identity (as Rovo and Salesforce do).

Drafts and checks (outside the repo, `C:\Users\DELL\Documents\work\ask-handover\`):
- `S1-draft\step2-ask\`: Ask's agent loop (`agent.ts`: `Model`, `Data`, `answer()`,
  `MAX_STEPS = 8`), the stand-in (`stand-in.ts`: "chats" and "tickets" rules over
  `query_rows`), `data.ts` (the plug over `ctx.featherbase`). Still written as one action;
  step 2 moves the loop into the `think` read.
- `S1-draft\step1-platform.diff` and `featherbase-tools.test.ts`: the first step 1 draft.
  **Stale on identity**: it forwards the browser session (`authCredential(c)` threaded through
  `app-routes.ts` → `runPackageAction` → `executeRuntimeAction`) and hands the tools to an
  action. Reuse its shape (types, flag, in-memory client, read-only filter, the test's
  cases); replace the identity with the pass and the action with an outbound read.
- `B1-draft\`: an older loop with a hand-made `query_rows`; superseded, ignore.
- `checks\checkB2-ask.cjs "<question>"` asks through Ask's action as Administrator (sends
  `X-Featherbase-App-Version: ask@0.1.0`; without it every call is 403 "Application access
  refused"). `checkB2-ask-b1.cjs` is the same against the throwaway instance.
- Throwaway instance for checks that change Ask's manifest: database `fb_ask_b1`, ports
  8078/5178, Ask and Tickets installed (start with `DATABASE_URL`, `API_PORT`, `WEB_PORT`
  set in the environment; it overrides `.env.local`). Ask's manifest gains a flag in step 2,
  and at 0.1.0 that means recreating `fb_ask_ui` and losing its test chats: ask Mohammad first.

## Frontend, later (after the backend)

- A chat added to moves to the top (needs a "last asked" time on the chat; ChatGPT orders
  by last use), and a brand-new chat's address becomes `/ask/?chat=<id>` after its first
  answer (today it stays `/ask/`).
- Group the lists by Today, Yesterday, Previous 7 days, Previous 30 days.
- Each figures answer shows what it covers, how recent, the request that ran, and a link to
  the matching report (#1377 point 15). The limit shown under the box (point 14).
- Step 3: the panel on every page.
- Optional tidy-ups Mohammad left in 2d's files: `RecentChats.tsx` lines 2–3 still say
  chats open their Featherbase record "for now", and its `ChatLink` comment sits above
  `useEffect(load, [])`; `Chat.tsx` and `Sidebar.tsx` add imports on separate lines and lost
  some comments. `ask-handover\2d-draft\` has the tidy versions.
- Then the independent headless verifier at desktop width (its checklist includes: "Every
  record shown (person, store, section, department, ticket, and so on) is a link that opens
  it, or plain text only where the viewer may not open it."), remove this note, and the PR
  only when Mohammad says so.
