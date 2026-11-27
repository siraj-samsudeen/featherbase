# Feather Ask UI (#1377, Phase 1): hand-over

**Last updated:** 27-Nov-2026 (backend 1a to 1e committed; ADR 0028; 1e2 deferred; 1f committed; 1f2 moved to the final step; 1g skipped; step 1 done; 2.1, 2.2 and 2.2b committed; next: 2.3). A working note for moving between machines and sessions. It is
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
- **How Ask reaches the tools: the caller's own credential** (Mohammad, 27-Nov-2026,
  [ADR 0028](../../adr/0028-an-apps-agent-reads-with-the-callers-own-credential.md)):
  in-process, no network: the same MCP tool server built in memory (`InMemoryTransport`),
  each tool's inner `/api` call made with `app.request` as `/mcp` does. The read route wraps
  the credential the read came with (session or access token) in a `Credential` that never
  prints itself, and every tool call sends it as its header inside `runAsAgent`, so every
  front-door check applies and history reads "via Ask". No token is made; a read the server
  starts itself gets no tools. Only the read-only tools are offered or run. History of this
  choice: a 5-minute access-token pass (1c, 26 Nov) was replaced because it needed rows, a
  cache, renewal, a sweep and a column to hide it; a "no token, person on the in-memory
  mark" version was drafted as ADR 0028 on 26 Nov and rewound before push. ADR 0021 still
  governs `/mcp`.
- **View as is left for later** (Mohammad, 27-Nov-2026): while viewing as someone, the GET
  tools answer as the person viewed but `check_import` and `suggest_table` (POST dry runs)
  as the tester. Nothing leaks; the answer can mislead. Task 1f2, design Open Questions;
  decided at the final step, after all the implementation (road to done, step 8).
- **What the agent read is kept with the answer** (Mohammad, 27-Nov-2026): each question
  saves the steps behind its answer (task 2.2b), which the person and an administrator can
  see. The Access Log entry per tool call (1e2) is **deferred**: ordinary reads aren't logged,
  the agent reads only what the person may open, and Ask is the only agent. Revisit when a
  second app declares `featherbaseMcp` or step 3 sends rows to an outside model.
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

## Where we are (27-Nov-2026)

**Ask is an AI agent over every app the person can use** (Mohammad, 26-Nov-2026). It does not
follow #1377's Agreed design: #1377's own tools (point 6), fixed retries (point 7), the admin's
askable list (point 12) and prepared queries for joins (point 13) are dropped; Recent Chats
replaces "My Questions"; OpenRouter later replaces OpenCode Zen. Tell Siraj.

How it works: the model gets the question and Featherbase's read-only MCP tools (7 today, in
`apps/server/src/mcp.ts` and `mcp-table-tools.ts`: `list_tables` lists every Table the person
can read, across all apps; `describe_table`, `query_rows`, `get_row`, `list_imports`,
`check_import`, `suggest_table`). It calls them as often as it needs (at most 8 steps), with the
person's own credential, then writes the answer. A refusal is a tool result it reads.

**The record for whoever picks this up is OpenSpec**, kept current with every commit:
`openspec/changes/feather-ask-ui` (the page, built) and `openspec/changes/feather-ask-agent`
(the backend: design with every decision and its rejected options, tasks ticked with commit
hashes), plus ADR 0028. This note adds only how we work and where the drafts are.

Done on the backend (step 1, the platform piece):
- 1a the shared types (`87f4552ea`), 1b the manifest flag `featherbaseMcp`, refused without
  `outbound` (`b27055fbe`), 1c the in-memory tools in `mcp-app-reads.ts` (`4900bc34a`, with a
  pass that 1e removes), 1d `executeRuntimeRead` hands `ctx.featherbaseMcp` to a read that
  declares the flag (`2db345742`), 1e the tools carry the caller's own credential in a
  `Credential` that never prints itself (`caller-credential.ts`, `def132bfd`; checked: both
  typechecks, `checks\check1e.mts` 14/14, 496 tests in 13 files, platform imports), 1f the
  server test `featherbase-mcp.test.ts`: 12 tests over HTTP with `action-proof`'s `tools` and
  `untooled` reads (`dffb84cc1`).

## Next step: step 2, the agent loop in Ask (2.1, 2.2, 2.2b done; next 2.3)

Step 1 (the platform piece) is finished: 1a–1f committed, 1e2 deferred, 1f2 (View as) moved to
the final step, 1g's adversarial review offered and skipped (Mohammad, 27-Nov-2026).

**2.1 is done** (`e71a8d9ab`, typed by Mohammad): `example-apps/ask/src/server/agent.ts` (the
loop: `Model`, `McpTools`, `answer()`, `MAX_STEPS = 8`), `stand-in.ts` ("chats" and "tickets"
rules over `query_rows`), `reads.think` in `index.ts` (outbound, `featherbaseMcp`; saves
nothing), the read in `featherbase.json`. `fb_ask_ui` was recreated for the manifest change
(27-Nov-2026), with two test tickets. Checks: `checks\check2.1-think-ui.cjs` (8, HTTP on 5177),
`2.1-draft\check-agent.mts` (4, the loop with fake tools), `ask-app.test.ts` (6).

**2.2 is done** (`e91e33bf5`, put in by Claude at Mohammad's "implement it"): the page passes
think's answer to the `ask` action as `payload.answer = { kind, text }`; `answerFrom()` in
`index.ts` checks it (kind `answer` or `cannot`, text not blank, at most `MAX_ANSWER_LENGTH` =
20000 from `shared/reply.ts`) before anything is saved; refused with 417 "Ask has no answer to
save". Unsigned until 2.4 (Mohammad chose "unsigned now, 2.4 later"; design `a21522a03`).
`reply.ts` removed. **Until 2.3 the Ask page can't save a question** (it sends no answer).
Checks: `ask-app.test.ts` 7, `checks\check2.2-save.cjs` 7 (HTTP on 5177). Draft in
`ask-handover\2.2-draft\`. `check2.1-think-ui.cjs`'s last check (placeholder) now fails on purpose.

**2.2b is done** (`68d920951`, put in by Claude at Mohammad's "make this change"; design
`c2f83359f`): `think` returns `{ answer, steps }` (type `Thought` in `shared/reply.ts`), each
step `{ tool, args, summary, refused? }` with a short summary ("2 rows", "refused: …"), no rows;
`ask` checks the steps (`stepsFrom()`: at most 8, shape, summary ≤ 200, all ≤ `MAX_STEPS_LENGTH`
= 20000) and saves them in the JSON column `steps`. `fb_ask_ui` was recreated (27-Nov-2026) with
Ask and Tickets and the two test tickets (`checks\add-two-tickets-5177.cjs`). Checks:
`ask-app.test.ts` 8, `2.2b-draft\check-agent.mts` 8, `checks\check2.2b-steps.cjs` 11 (HTTP).
Mohammad's choices: recreate `fb_ask_ui`; JSON objects, as ChatGPT and Claude keep steps; show
the steps only when asked, by Ctrl+O or a small link under the answer (task 2.3b). Ctrl+O is the
browser's "Open file": the page can take it while focused; settle it in 2.3b.

**Next: 2.3**, the page calls think, then ask, under the one "Thinking…": `src/client/api.ts`
(a `think()` call to `/api/app_reads/ask/think`, then `askQuestion` passes `answer` and
`steps`) and `components/Chat.tsx` (`fetchAnswer`). After it the page saves questions again.
No manifest change. Then **2.3b** (show the steps) and **2.4** (decide signing). Ask Mohammad
any design question first, one at a time, with a recommendation; draft in
`ask-handover\2.3-draft\`; check headless (reuse `checks\check2a-ui.cjs` and `check2d.cjs`).

**What step 2 builds** (tasks 2.1–2.4 in `feather-ask-agent/tasks.md`): Ask stops answering
with the placeholder (`src/server/reply.ts`) and answers with an agent loop over the platform's
tools, still with a **stand-in model** (rules, no AI service yet; Gemini and Groq come in step 3).
Think first, save at the end (see Decisions):

```
page ─▶ think (outbound read, featherbaseMcp) ─▶ loop: model picks a tool ─▶ ctx.featherbaseMcp.call ─▶ … ≤ 8 steps ─▶ answer + steps
     ─▶ ask (action, one transaction) ─▶ saves chat, question, answer, steps ─▶ page shows the answer
```

1. **2.1** A `think` read in Ask's manifest (`example-apps/ask/featherbase.json`): `outbound:
   true`, `featherbaseMcp: true`. Its handler runs the loop with `ctx.featherbaseMcp` (`tools()`,
   `call(name, args)`), at most 8 steps; a refused call is a result the model reads; out of
   steps after a refusal, the person is told its reason.
2. **2.2** The `ask` action (already saves chat, question and answer, step 2a) saves the answer
   `think` gave instead of calling the placeholder.
3. **2.2b** `think` also returns the steps it took (tool, Table, filters, short result, e.g.
   "query_rows on Ticket, status = Open: 3 rows"); `ask` saves them in a new column on
   `ask.question`. No rows copied in full. This is now the only record of what the agent read
   (1e2 deferred).
4. **2.3** The page (`src/client/api.ts`, `components/Chat.tsx`) calls think, then ask, under
   the one "Thinking…".
5. **2.4** Decide (ask Mohammad): sign the answer between think and ask, or accept that a
   person could save any answer to their own chat.

**Before changing Ask's manifest, ask Mohammad:** Ask stays at 0.1.0, so a manifest change means
recreating `fb_ask_ui` and losing its test chats (or use the throwaway `fb_ask_b1`, below).
2.2b adds a column to `ask.question`, so it is such a change.

Drafts for step 2 go in `ask-handover\2.2-draft\` and so on; 2.1's is `ask-handover\2.1-draft\`.

**Platform pieces step 2 relies on** (all committed): the manifest flag (1b, refused without
`outbound`), `ctx.featherbaseMcp` on such a read (1d), the caller's own credential on every tool
call (1e, `caller-credential.ts`, `mcp-app-reads.ts`), the server test (1f,
`apps/server/test/featherbase-mcp.test.ts`).

**How to go** (see How we work): one small piece at a time. Claude drafts it outside the repo
(`ask-handover\2.2-draft\` and so on), checks it (server typecheck, `pnpm --filter server test
test/ask-app.test.ts`, HTTP or headless browser), then gives Mohammad the walkthrough;
Mohammad types it in or says "make this change"; commit; tick the task; move this section on.
No push, no PR.

Running server tests: never stop vitest from outside on Windows; its workers live on and hold
`featherbase_test`. Let a run end by itself (the pause tests release in `finally`).

## The road to done

Backend, then the rest of the page, then the PR. Each line is one or more small steps, each
ending in a manual check and a commit; the details are in `feather-ask-agent/tasks.md`.

1. **Finish the platform piece (step 1).**
   - 1e2: deferred (the Access Log entry per tool call; 2.2b's saved steps cover it for now).
   - 1f (done, `dffb84cc1`): the server test `apps/server/test/featherbase-mcp.test.ts`, with a `tools` outbound
     read in `test-apps/action-proof`: read-only tools only, Selvi sees her row and Ravi none,
     no token made, turned off / signed out everywhere / signed out of that session refused,
     an access-token caller works, no caller gets no tools, the credential never leaks.
   - 1f2: moved to step 8 (View as), after all the implementation.
   - 1g: adversarial review offered, skipped by Mohammad (27-Nov-2026).
2. **The agent loop in Ask, with a stand-in model (step 2). Next.** A `think` outbound read runs the
   loop; the `ask` action saves chat, question, answer and the steps behind it (2.2b); the page
   calls think, then ask, under one "Thinking…". Decide whether to sign the answer between them.
   Ask's manifest changes at 0.1.0, so recreating `fb_ask_ui` loses its test chats: ask
   Mohammad first. Starting draft: `ask-handover\S1-draft\step2-ask\`.
3. **A real model (step 3).** Gemini and Groq through one OpenAI-style adapter with tool
   calling, keys as Ask's secrets; choose the models. Specify and build #1377 points 8 (say
   what was left out) and 19 (text is data, never an instruction; provider errors only to an
   admin).
4. **Reach every app (step 4).** An app marks a read for agents (description, input schema);
   the platform offers it as a tool `<app>.<read>`, run as the person. First: Dash's `report`.
5. **Figures (step 5).** A read-only sum and group tool, once a figures question needs it.
6. **Limits, budget and the log (step 6);** OpenRouter, billing and choosing a model.
7. **The page, after the backend** (see "Frontend, later" below): a chat moves to the top when
   added to, date groups, what each figures answer covers (#1377 points 14 and 15), and the
   panel on every page.
8. **View as, then tests and review.** First 1f2: decide and build View as for Ask's tools
   (A, pin the View as for the whole question, recommended; B, no tools while viewing as
   someone; design, Open Questions), moved here by Mohammad on 27-Nov-2026. Then fence each scenario of both changes as Gherkin and bind it to a test
   (`pnpm check:scenarios`); the independent headless verifier at desktop width with the
   RecordLink checklist line; a code review (`feather-code-review`).
9. **Finish.** Fold this note into the PR body and remove it; archive both OpenSpec changes;
   the PR, or a push to `main` under the trial rules in `AGENTS.md`, **only when Mohammad says
   so**. Tell Siraj about every departure from #1377 listed above.

Later, outside this issue: writes on request with the person's confirmation (#1372), and a
scheduled Ask with nobody signed in, which needs its own agent identity.

Drafts and checks (outside the repo, `C:\Users\DELL\Documents\work\ask-handover\`):
- `1e-draft\`: 1e, now committed (`def132bfd`). `1f-draft\`: 1f, now committed (`dffb84cc1`).
- `checks\check1e.mts`: 1e's check (14 checks). `checks\check1d.mts` tests 1d as committed
  (with the pass); it fails once 1e is in, since the pass and its rows are gone.
- `1e-no-token-rejected\`: the rejected "person on the mark" draft and its check. Do not use.
- `view-as-note-27nov.diff`: the side session's View as note, already in the design.
- `S1-draft\step2-ask\`: Ask's agent loop (`agent.ts`: `Model`, `Data`, `answer()`,
  `MAX_STEPS = 8`), the stand-in (`stand-in.ts`: "chats" and "tickets" rules over
  `query_rows`), `data.ts` (the plug over `ctx.featherbase`, now `ctx.featherbaseMcp`). Still
  written as one action; step 2 moves the loop into the `think` read.
- `S1-draft\step1-platform.diff` and `featherbase-tools.test.ts`: the first step 1 draft, on an
  action. Its test cases are a start for 1f; its identity and wiring are superseded by 1c–1e.
- `B1-draft\`: an older loop with a hand-made `query_rows`; superseded, ignore.
- `checks\checkB2-ask.cjs "<question>"` asks through Ask's action as Administrator (sends
  `X-Featherbase-App-Version: ask@0.1.0`; without it every call is 403 "Application access
  refused"). `checkB2-ask-b1.cjs` is the same against the throwaway instance.
- Throwaway instance for checks that change Ask's manifest: database `fb_ask_b1`, ports
  8078/5178, Ask and Tickets installed (start with `DATABASE_URL`, `API_PORT`, `WEB_PORT`
  and `FEATHERBASE_APP_PATHS` set in the environment; it overrides `.env.local`). The platform
  also loads the checkout's own Ask for an installed app, so a drafted Ask with the same
  version clashes ("Duplicate different artifacts"): give the check copy (`2.1-check\ask`)
  another version, 0.1.1, and send `ask@0.1.1`.

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
